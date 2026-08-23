/**
 * `MCPWriteBack` (Phase 3 day-06) — the {@link WriteBackService} adapter that
 * rides the Week-1 MCP transport for *write* calls.
 *
 * Write-back never opens a second channel: a `WriteBackIntent` resolves to the
 * provider's MCP client, maps the action to a tool name via the same
 * {@link GitToolMap}/{@link TicketToolMap} the read path uses, and calls it. A
 * comment/status/label/transition is a tool call with a side effect, not a code
 * change — and because both read and write go through `@harness/mcp`, there is
 * exactly one way the harness talks to Git/ticket systems (day-06 §2.1).
 *
 * The `enabled(provider)` guard is the toggle: OFF means no tool is ever called
 * and the intent resolves to a successful no-op. The default reads a `WRITEBACK_*`
 * env var per provider; Day-09 promotes it to a per-review decision toggle.
 */

import { TicketProviderType, WritebackAction } from '@harness/domain';
import type {
  GitProviderType,
  WriteBackIntent,
  WriteBackProvider,
  WriteBackResult,
} from '@harness/domain';
import { McpConfigError } from '@harness/mcp';
import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { parseRepoPath } from '@harness/git-provider';
import type { GitHost, GitToolMap } from '@harness/git-provider';
import type { TicketSystem, TicketToolMap } from '@harness/ticket-provider';

import { WriteBackError } from './writeback-service.js';
import type { WriteBackService } from './writeback-service.js';

/** Injectable knobs for {@link MCPWriteBack}. */
export interface MCPWriteBackOptions {
  /**
   * Whether write-back is enabled for a provider, defaulting to the env check
   * (`WRITEBACK_<PROVIDER>=1|true`). Returning false is a successful no-op.
   */
  readonly enabled?: (provider: WriteBackProvider) => boolean;
}

/**
 * The off-by-default toggle: `WRITEBACK_GITHUB=1` (etc.) arms the provider. An
 * unset var means OFF — nothing external is ever written by accident.
 */
function envEnabled(
  provider: WriteBackProvider,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env[`WRITEBACK_${provider.toUpperCase()}`];
  return value === '1' || value === 'true';
}

/** The first human-readable text out of a tool result's content blocks (may be empty). */
function contentText(result: ToolResult): string {
  for (const block of result.content) {
    if (block.type === 'text') {
      return block.text;
    }
    if (block.type === 'resource' && typeof block.resource['text'] === 'string') {
      return block.resource['text'];
    }
  }
  return '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Best-effort recover of the host's handle for the written thing: an `id`/`key`
 * field out of a JSON text result, else the raw text, else `undefined`.
 */
function externalRef(result: ToolResult): string | undefined {
  const text = contentText(result);
  if (text === '') {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      if (typeof parsed['id'] === 'string' || typeof parsed['id'] === 'number') {
        return String(parsed['id']);
      }
      if (typeof parsed['key'] === 'string') {
        return parsed['key'];
      }
    }
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return text;
}

export class MCPWriteBack implements WriteBackService {
  constructor(
    private readonly registry: McpServerRegistry,
    private readonly gitToolMap: GitToolMap,
    private readonly ticketToolMap: TicketToolMap,
    private readonly options: MCPWriteBackOptions = {},
  ) {}

  async write(intent: WriteBackIntent): Promise<WriteBackResult> {
    const enabled = this.options.enabled ?? envEnabled;
    if (!enabled(intent.provider)) {
      return { ok: true, intentId: intent.id };
    }

    try {
      return intent.provider === TicketProviderType.Jira
        ? await this.writeTicket(intent)
        : await this.writeGit(intent);
    } catch (error) {
      // An invalid intent is a programming error (stay loud); anything else is a
      // write FAILURE (record it). A stray host REST failure surfaces here, never
      // as an unhandled rejection.
      if (error instanceof WriteBackError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, intentId: intent.id, error: message };
    }
  }

  /** COMMENT → comment tool, STATUS → status tool, LABEL → label tool, TRANSITION → reject. */
  private async writeGit(intent: WriteBackIntent): Promise<WriteBackResult> {
    const gitHost = intent.provider as GitProviderType;
    if (intent.repo === undefined) {
      throw new WriteBackError(`git write-back action "${intent.action}" requires a "repo" slug`);
    }
    const { owner, name } = parseRepoPath(intent.repo);
    const number = Number(intent.externalId);
    if (!Number.isInteger(number)) {
      throw new WriteBackError(
        `git write-back externalId must be a PR/MR number, got "${intent.externalId}"`,
      );
    }

    const client = await this.clientFor(gitHost);
    const tools = this.gitToolMap.resolve(gitHost);

    switch (intent.action) {
      case WritebackAction.Comment: {
        const args = this.gitToolMap.buildCommentArgs(gitHost, {
          owner,
          name,
          number,
          body: intent.body ?? '',
        });
        const result = await client.callTool(tools.commentTool, args);
        return result.isError
          ? { ok: false, intentId: intent.id, error: `git comment failed: ${contentText(result)}` }
          : { ok: true, intentId: intent.id, ...externalRefOf(result) };
      }
      case WritebackAction.Status: {
        const args = this.gitToolMap.buildStatusArgs(gitHost, {
          owner,
          name,
          number,
          state: intent.state ?? 'pending',
          description: intent.body ?? '',
        });
        const result = await client.callTool(tools.statusTool, args);
        return result.isError
          ? { ok: false, intentId: intent.id, error: `git status failed: ${contentText(result)}` }
          : { ok: true, intentId: intent.id, ...externalRefOf(result) };
      }
      case WritebackAction.Label: {
        const label = intent.label ?? intent.body;
        if (label === undefined) {
          throw new WriteBackError('git label write-back requires a "label"');
        }
        const args = this.gitToolMap.buildLabelArgs(gitHost, { owner, name, number, label });
        const result = await client.callTool(tools.labelTool, args);
        return result.isError
          ? { ok: false, intentId: intent.id, error: `git label failed: ${contentText(result)}` }
          : { ok: true, intentId: intent.id, ...externalRefOf(result) };
      }
      case WritebackAction.Transition:
        throw new WriteBackError(
          `TRANSITION is not supported for Git host "${gitHost}"; use the Jira provider`,
        );
      default:
        throw new WriteBackError(`unsupported write-back action "${String(intent.action)}"`);
    }
  }

  /** COMMENT → comment tool, TRANSITION → transition tool, STATUS/LABEL → reject. */
  private async writeTicket(intent: WriteBackIntent): Promise<WriteBackResult> {
    // Today there is exactly one ticket system; `intent.provider` is `jira` here.
    const system = TicketProviderType.Jira;
    const client = await this.clientFor(system);
    const tools = this.ticketToolMap.resolve(system);

    switch (intent.action) {
      case WritebackAction.Comment: {
        const args = this.ticketToolMap.buildCommentArgs(system, {
          key: intent.externalId,
          body: intent.body ?? '',
        });
        const result = await client.callTool(tools.commentTool, args);
        return result.isError
          ? {
              ok: false,
              intentId: intent.id,
              error: `jira comment failed: ${contentText(result)}`,
            }
          : { ok: true, intentId: intent.id, ...externalRefOf(result) };
      }
      case WritebackAction.Transition: {
        const toState = intent.toState ?? intent.label;
        if (toState === undefined) {
          throw new WriteBackError('jira transition write-back requires a "toState"');
        }
        const args = this.ticketToolMap.buildTransitionArgs(system, {
          key: intent.externalId,
          targetState: toState,
        });
        const result = await client.callTool(tools.transitionTool, args);
        return result.isError
          ? {
              ok: false,
              intentId: intent.id,
              error: `jira transition failed: ${contentText(result)}`,
            }
          : { ok: true, intentId: intent.id, ...externalRefOf(result) };
      }
      case WritebackAction.Status:
      case WritebackAction.Label:
        throw new WriteBackError(
          `"${intent.action}" is not supported for ticket systems (use TRANSITION)`,
        );
      default:
        throw new WriteBackError(`unsupported write-back action "${String(intent.action)}"`);
    }
  }

  /** A provider with no config entry is "unknown" rather than a raw MCP error. */
  private async clientFor(provider: GitHost | TicketSystem): Promise<McpClient> {
    try {
      return await this.registry.get(provider);
    } catch (error) {
      if (error instanceof McpConfigError) {
        throw new WriteBackError(`no MCP server configured for provider "${provider}"`, {
          cause: error,
        });
      }
      throw error;
    }
  }
}

/** Shape the `externalRef?` result field, omitting it (exactOptional) when absent. */
function externalRefOf(result: ToolResult): { externalRef?: string } {
  const ref = externalRef(result);
  return ref === undefined ? {} : { externalRef: ref };
}
