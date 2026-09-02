/**
 * `MCPTicketProvider` (Phase 3 day-04) — one {@link TicketProvider} that fronts a
 * Jira MCP server, instead of a REST adapter.
 *
 * The transport changed, the seam stayed: read *and* write ride the same MCP
 * tools. `fetchIssue` drives Jira's mapped `get_issue` tool; `postComment` and
 * `transition` drive the mapped comment/transition tools. "Add another ticket
 * system" is a `mcp.config.json` entry + a `TicketToolMap` row — not a new class
 * (day-04 §1, §2).
 *
 * Write primitives are commentary/status only — never code (the invariant the
 * whole re-orient enforces). The Day-06 `WriteBackService` wraps these same tool
 * calls with a toggle + idempotency + audit; the provider exposes the raw
 * capability for free.
 */

import { TicketProviderType } from '@harness/domain';
import type { Issue } from '@harness/domain';
import { McpConfigError } from '@harness/mcp';
import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';

import { TicketProviderError } from './ticket-provider.js';
import type { FetchIssueInput, TicketProvider } from './ticket-provider.js';
import { mapMcpTicketIssue } from './mcp-ticket-mapper.js';
import type { TicketSystem, TicketToolMap } from './ticket-tool-map.js';

/** The ticket system resolves to an MCP server name with no config entry. */
export class UnknownTicketSystemError extends TicketProviderError {
  constructor(system: string) {
    super(`no ticket MCP provider configured for "${system}"`);
    this.name = 'UnknownTicketSystemError';
  }
}

/** The first human-readable text out of a tool result's content blocks (may be empty). */
function contentText(result: ToolResult): string {
  for (const block of result.content) {
    if (block.type === 'text') {
      return block.text;
    }
    if (block.type === 'resource' && typeof block.resource.text === 'string') {
      return block.resource.text;
    }
  }
  return '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Recover the list of available transition names from a failed transition's
 * result, if the server returned one. Jira MCP servers surface "no such status"
 * in two shapes — a `statuses`/`transitions`/`available` array of strings or of
 * `{ name }` objects. Whichever shape, this reduces it to a flat name list; an
 * unrecognized shape degrades to `[]` rather than throwing.
 */
function extractAvailableStatuses(result: ToolResult): string[] {
  const raw = contentText(result);
  if (raw === '') {
    return [];
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(payload)) {
    return [];
  }
  const candidates =
    (Array.isArray(payload['statuses']) && payload['statuses']) ||
    (Array.isArray(payload['transitions']) && payload['transitions']) ||
    (Array.isArray(payload['available']) && payload['available']);
  if (!Array.isArray(candidates)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of candidates) {
    if (typeof entry === 'string') {
      names.push(entry);
    } else if (isRecord(entry) && typeof entry['name'] === 'string') {
      names.push(entry['name']);
    }
  }
  return names;
}

/** Raise a {@link TicketProviderError} from a failed write result, listing statuses where present. */
function failWrite(action: 'comment' | 'transition', targetState: string | undefined, result: ToolResult): never {
  const detail = contentText(result);
  const available = action === 'transition' ? extractAvailableStatuses(result) : [];
  const target = action === 'transition' && targetState !== undefined ? ` to "${targetState}"` : '';
  const statuses = available.length > 0 ? ` (available statuses: ${available.join(', ')})` : '';
  throw new TicketProviderError(`jira ${action}${target} failed${detail ? `: ${detail}` : ''}${statuses}`);
}

export class MCPTicketProvider implements TicketProvider {
  readonly type = TicketProviderType.Jira;

  constructor(
    private readonly registry: McpServerRegistry,
    private readonly toolMap: TicketToolMap,
    private readonly baseUrl: string,
  ) {}

  async fetchIssue(input: FetchIssueInput): Promise<Issue> {
    const system = TicketProviderType.Jira;
    const client = await this.clientFor(system);
    const { getIssueTool } = this.toolMap.resolve(system);
    const args = this.toolMap.buildArgs(system, { key: input.key });

    const result = await client.callTool(getIssueTool, args);
    return mapMcpTicketIssue(system, this.baseUrl, result);
  }

  async postComment(input: FetchIssueInput, body: string): Promise<void> {
    const system = TicketProviderType.Jira;
    const client = await this.clientFor(system);
    const { commentTool } = this.toolMap.resolve(system);
    const args = this.toolMap.buildCommentArgs(system, { key: input.key, body });

    const result = await client.callTool(commentTool, args);
    if (result.isError) {
      failWrite('comment', undefined, result);
    }
  }

  async transition(input: FetchIssueInput, targetState: string): Promise<void> {
    const system = TicketProviderType.Jira;
    const client = await this.clientFor(system);
    const { transitionTool } = this.toolMap.resolve(system);
    const args = this.toolMap.buildTransitionArgs(system, { key: input.key, targetState });

    const result = await client.callTool(transitionTool, args);
    if (result.isError) {
      failWrite('transition', targetState, result);
    }
  }

  /** A system with no config entry is "unknown" rather than a raw MCP error. */
  private async clientFor(system: TicketSystem): Promise<McpClient> {
    try {
      return await this.registry.get(system);
    } catch (error) {
      if (error instanceof McpConfigError) {
        throw new UnknownTicketSystemError(system);
      }
      throw error;
    }
  }
}
