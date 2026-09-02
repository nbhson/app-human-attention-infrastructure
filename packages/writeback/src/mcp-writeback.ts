/**
 * `MCPWriteBack` (Phase 3 day-06, audited day-08) — the {@link WriteBackService}
 * adapter that rides the Week-1 MCP transport for *write* calls.
 *
 * Write-back never opens a second channel: a `WriteBackIntent` resolves to the
 * provider's MCP client, maps the action to a tool name via the same
 * {@link GitToolMap}/{@link TicketToolMap} the read path uses, and calls it. A
 * comment/status/label/transition is a tool call with a side effect, not a code
 * change — and because both read and write go through `@harness/mcp`, there is
 * exactly one way the harness talks to Git/ticket systems (day-06 §2.1).
 *
 * The `enabled(provider)` guard is the toggle: OFF means no tool is ever called
 * and the intent resolves to a successful no-op with nothing recorded (day-06
 * §2.4). Day-09 promotes it to a per-review decision toggle.
 *
 * Day-07 completes the **full provider matrix** — GitHub/GitLab/Bitbucket comment
 * + status and Jira comment + transition — with the per-host variance living
 * entirely in the tool maps, so no per-host write class exists.
 *
 * Day-08 adds the **audit + idempotency** layer: `write()` is claim-then-write.
 * A deterministic dedup key is claimed on the injected {@link WritebackLogStore}
 * before any tool is called; a retried or racing identical intent resolves to a
 * `DUPLICATE` row with no second external call, and every other attempt records a
 * `PENDING` row flipped to `SUCCEEDED`/`FAILED` (day-08 §2.4). Invalid intents are
 * validated *before* the claim and throw {@link WriteBackError} — they are
 * programming errors, not external write attempts, and are never logged.
 */

import { TicketProviderType, WritebackAction } from '@harness/domain';
import type {
  GitProviderType,
  WriteBackIntent,
  WriteBackProvider,
  WriteBackResult,
  WritebackLogStore,
} from '@harness/domain';
import { McpConfigError } from '@harness/mcp';
import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { parseRepoPath } from '@harness/git-provider';
import type { GitHost, GitToolMap } from '@harness/git-provider';
import type { TicketSystem, TicketToolMap } from '@harness/ticket-provider';

import { dedupKey, effectiveBody } from './dedup.js';
import { credentialEnvValues, redactSensitive } from './redact.js';
import { WriteBackError } from './writeback-service.js';
import type { WriteBackService } from './writeback-service.js';

/** Injectable knobs for {@link MCPWriteBack}. */
export interface MCPWriteBackOptions {
  /**
   * Whether write-back is enabled for a provider, defaulting to the env check
   * (`WRITEBACK_<PROVIDER>`, ON by default — set `0`/`false` to opt a host out).
   * Returning false is a successful no-op with no audit row.
   */
  readonly enabled?: (provider: WriteBackProvider) => boolean;
}

/**
 * The per-provider toggle, **on by default**: `WRITEBACK_GITHUB=0` (etc.) opts a
 * host out. An unset var means ON — a configured host writes without extra setup,
 * and disabling is the explicit act.
 */
function envEnabled(provider: WriteBackProvider, env: Record<string, string | undefined> = process.env): boolean {
  const value = env[`WRITEBACK_${provider.toUpperCase()}`];
  return value !== '0' && value !== 'false';
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

/** Shape the `externalRef?` result field, omitting it (exactOptional) when absent. */
function externalRefOf(result: ToolResult): { externalRef?: string } {
  const ref = externalRef(result);
  return ref === undefined ? {} : { externalRef: ref };
}

export class MCPWriteBack implements WriteBackService {
  /** Env credentials used to scrub secret bytes out of logged errors (day-08 §2.3). */
  private readonly secretValues: readonly string[];

  constructor(
    private readonly registry: McpServerRegistry,
    private readonly gitToolMap: GitToolMap,
    private readonly ticketToolMap: TicketToolMap,
    private readonly store: WritebackLogStore,
    private readonly options: MCPWriteBackOptions = {},
  ) {
    this.secretValues = credentialEnvValues(process.env);
  }

  async write(intent: WriteBackIntent): Promise<WriteBackResult> {
    const enabled = this.options.enabled ?? envEnabled;
    if (!enabled(intent.provider)) {
      return { ok: true, intentId: intent.id };
    }

    // Invalid intents throw before any audit row exists — they are programming
    // errors to fix, not external failures to log (day-06 §2.3).
    this.validate(intent);

    const claim = await this.store.claim({
      intentId: intent.id,
      provider: intent.provider,
      externalId: intent.externalId,
      action: intent.action,
      body: effectiveBody(intent),
      dedupKey: dedupKey(intent),
      ...(intent.decisionId === undefined ? {} : { decisionId: intent.decisionId }),
    });
    if (claim === 'duplicate') {
      return { ok: true, intentId: intent.id };
    }

    try {
      const result =
        intent.provider === TicketProviderType.Jira ? await this.writeTicket(intent) : await this.writeGit(intent);
      if (result.ok) {
        await this.store.finalize(
          result.externalRef === undefined
            ? { intentId: intent.id, status: 'SUCCEEDED' }
            : { intentId: intent.id, status: 'SUCCEEDED', externalRef: result.externalRef },
        );
        return result;
      }
      const redacted = this.redact(result.error ?? 'write-back failed');
      await this.store.finalize({
        intentId: intent.id,
        status: 'FAILED',
        error: redacted,
      });
      return { ...result, error: redacted };
    } catch (error) {
      // Validation already passed, so this is a transport/host failure — a
      // recordable FAILED attempt, never an unhandled rejection.
      const message = error instanceof Error ? error.message : String(error);
      const redacted = this.redact(message);
      await this.store.finalize({
        intentId: intent.id,
        status: 'FAILED',
        error: redacted,
      });
      return { ok: false, intentId: intent.id, error: redacted };
    }
  }

  /** Raise a {@link WriteBackError} carrying the target identity (day-07 §2.3). */
  private invalid(intent: WriteBackIntent, message: string): never {
    throw new WriteBackError(message, {
      provider: intent.provider,
      action: intent.action,
      externalId: intent.externalId,
    });
  }

  /** Redact secret bytes from a message before it is stored or returned (day-08 §2.3). */
  private redact(message: string): string {
    return redactSensitive(message, this.secretValues);
  }

  /** Validate an intent's shape without any side effect (day-08 §2.4). */
  private validate(intent: WriteBackIntent): void {
    if (intent.provider === TicketProviderType.Jira) {
      this.validateTicket(intent);
    } else {
      this.validateGit(intent);
    }
  }

  private validateGit(intent: WriteBackIntent): void {
    const gitHost = intent.provider as GitProviderType;
    if (intent.repo === undefined) {
      this.invalid(intent, `git write-back action "${intent.action}" requires a "repo" slug`);
    }
    const number = Number(intent.externalId);
    if (!Number.isInteger(number)) {
      this.invalid(intent, `git write-back externalId must be a PR/MR number, got "${intent.externalId}"`);
    }
    switch (intent.action) {
      case WritebackAction.Comment:
      case WritebackAction.Status:
        break;
      case WritebackAction.Label: {
        const label = intent.label ?? intent.body;
        if (label === undefined) {
          this.invalid(intent, 'git label write-back requires a "label"');
        }
        break;
      }
      case WritebackAction.Transition:
        this.invalid(intent, `TRANSITION is not supported for Git host "${gitHost}"; use the Jira provider`);
        break;
      default:
        this.invalid(intent, `unsupported write-back action "${String(intent.action)}"`);
    }
  }

  private validateTicket(intent: WriteBackIntent): void {
    switch (intent.action) {
      case WritebackAction.Comment:
        break;
      case WritebackAction.Transition: {
        const toState = intent.toState ?? intent.label;
        if (toState === undefined) {
          this.invalid(intent, 'jira transition write-back requires a "toState"');
        }
        break;
      }
      case WritebackAction.Status:
      case WritebackAction.Label:
        this.invalid(intent, `"${intent.action}" is not supported for ticket systems (use TRANSITION)`);
        break;
      default:
        this.invalid(intent, `unsupported write-back action "${String(intent.action)}"`);
    }
  }

  /** COMMENT → comment tool, STATUS → status tool, LABEL → label tool. */
  private async writeGit(intent: WriteBackIntent): Promise<WriteBackResult> {
    const gitHost = intent.provider as GitProviderType;
    const { owner, name } = parseRepoPath(intent.repo as string);
    const number = Number(intent.externalId);

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
        // `validateGit` guarantees a value, but narrowing the local union is the
        // guard the label tool's argument type needs.
        const label = intent.label ?? intent.body;
        if (label === undefined) {
          this.invalid(intent, 'git label write-back requires a "label"');
        }
        const args = this.gitToolMap.buildLabelArgs(gitHost, { owner, name, number, label });
        const result = await client.callTool(tools.labelTool, args);
        return result.isError
          ? { ok: false, intentId: intent.id, error: `git label failed: ${contentText(result)}` }
          : { ok: true, intentId: intent.id, ...externalRefOf(result) };
      }
      default:
        // Unreachable: `validateGit` rejects TRANSITION and unknown actions.
        return this.invalid(intent, `unsupported write-back action "${String(intent.action)}"`);
    }
  }

  /** COMMENT → comment tool, TRANSITION → transition tool. */
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
          this.invalid(intent, 'jira transition write-back requires a "toState"');
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
      default:
        // Unreachable: `validateTicket` rejects STATUS/LABEL and unknown actions.
        return this.invalid(intent, `unsupported write-back action "${String(intent.action)}"`);
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
          provider,
        });
      }
      throw error;
    }
  }
}
