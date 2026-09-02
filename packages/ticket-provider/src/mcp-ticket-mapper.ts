/**
 * Pure mapper from an MCP Jira issue tool result to a normalised {@link Issue}
 * (Phase 3 day-04). Kept separate from {@link MCPTicketProvider} so the mapping
 * is unit-testable against fixture {@link ToolResult}s with no live MCP server —
 * the same split as `jira-mapper.ts` / `mcp-git-mapper.ts`.
 *
 * The mapper flattens a `ToolResult.content` array into a single JSON document
 * and then reuses the existing {@link mapJiraIssue} (and its ADF→text flatten)
 * once it has narrowed the payload to the canonical Jira shape. It is *not*
 * per-server: it consumes the same `{ key, fields: { summary, … } }` shape the
 * Phase-1 REST mapper produced, transported as JSON-in-text. A missing `key` or
 * `fields.summary` raises {@link TicketProviderError} — a review that reads "no
 * requirement" must never be a silently-mangled mapping (day-04 §6).
 */

import type { Issue, TicketProviderType } from '@harness/domain';
import type { ToolResult } from '@harness/mcp';

import { TicketProviderError } from './ticket-provider.js';
import { mapJiraIssue } from './jira-mapper.js';
import type { JiraIssuePayload } from './jira-mapper.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse the single JSON document out of a tool result's content blocks. Accepts
 * the common MCP encodings: a `text` block whose payload is a JSON string, or a
 * `resource` block carrying JSON in `resource.text`. A `ToolResult.isError` or a
 * content array with no parseable JSON is a loud {@link TicketProviderError}.
 */
function parseJsonContent(result: ToolResult, context: string): unknown {
  if (result.isError) {
    throw new TicketProviderError(`${context}: MCP tool returned an error`);
  }
  for (const block of result.content) {
    if (block.type === 'text') {
      try {
        return JSON.parse(block.text);
      } catch {
        // not a JSON document here — keep scanning the remaining blocks
      }
    } else if (block.type === 'resource' && typeof block.resource.text === 'string') {
      try {
        return JSON.parse(block.resource.text);
      } catch {
        // keep scanning
      }
    }
  }
  throw new TicketProviderError(`${context}: tool content has no JSON payload`);
}

/** Narrow the get-issue payload to {@link JiraIssuePayload}, throwing on every missing required field. */
function parseIssue(result: ToolResult): JiraIssuePayload {
  const raw = parseJsonContent(result, 'get-issue tool');
  if (!isRecord(raw)) {
    throw new TicketProviderError('get-issue tool: payload is not an object');
  }
  const key = raw['key'];
  const fields = raw['fields'];
  if (typeof key !== 'string') {
    throw new TicketProviderError('get-issue tool: missing "key"');
  }
  if (!isRecord(fields) || typeof fields['summary'] !== 'string') {
    throw new TicketProviderError('get-issue tool: missing "fields.summary"');
  }
  const description = fields['description'];
  const issuetype = fields['issuetype'];
  const parsedIssuetype =
    isRecord(issuetype) && typeof issuetype['name'] === 'string' ? { name: issuetype['name'] } : undefined;
  return {
    key,
    fields: {
      summary: fields['summary'],
      ...(description === undefined ? {} : { description }),
      ...(parsedIssuetype === undefined ? {} : { issuetype: parsedIssuetype }),
    },
  };
}

/**
 * Map a get-issue tool result into an {@link Issue}. `baseUrl` is the Jira site
 * root (e.g. `https://acme.atlassian.net`), used to build the human-facing `url`.
 */
export function mapMcpTicketIssue(provider: TicketProviderType, baseUrl: string, result: ToolResult): Issue {
  return mapJiraIssue(provider, baseUrl, parseIssue(result));
}
