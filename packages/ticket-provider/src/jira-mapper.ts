/**
 * Pure mapper from a Jira issue payload to a normalised {@link Issue}
 * (review-reorient Phase 3). Also hosts the tiny ADF→text flatten used to turn
 * Jira's Atlassian Document Format description into plain text the AI reviewer
 * can read.
 */

import type { Issue, TicketProviderType } from '@harness/domain';

/** Subset of the Jira issue payload (`/rest/api/3/issue/{key}`). */
export interface JiraIssuePayload {
  readonly key: string;
  readonly fields: {
    readonly summary: string;
    readonly description?: unknown;
    readonly issuetype?: { readonly name?: string };
  };
}

/**
 * Flatten an Atlassian Document Format node into plain text by concatenating
 * every `text` leaf in document order. Unknown shapes degrade to the empty
 * string rather than throwing — a ticket with no description is a valid ticket.
 *
 * Whitespace is collapsed and trimmed *once* at the top level, so a trailing
 * space on one text leaf still separates it from the next leaf's first word.
 */
export function adfToPlainText(adf: unknown): string {
  const parts: string[] = [];
  collectTextLeaves(adf, parts);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Recursively append every `text` leaf (and any bare string) to `out`. */
function collectTextLeaves(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  const obj = node as { readonly text?: unknown; readonly content?: readonly unknown[] } | null;
  if (obj && typeof obj.text === 'string') {
    out.push(obj.text);
  }
  if (obj && Array.isArray(obj.content)) {
    for (const child of obj.content) {
      collectTextLeaves(child, out);
    }
  }
}

/**
 * Map a Jira issue into an {@link Issue}. `baseUrl` is the Jira site root (e.g.
 * `https://acme.atlassian.net`), used to build the human-facing `url`.
 */
export function mapJiraIssue(
  provider: TicketProviderType,
  baseUrl: string,
  payload: JiraIssuePayload,
): Issue {
  return {
    provider,
    key: payload.key,
    summary: payload.fields.summary,
    description: adfToPlainText(payload.fields.description),
    issueType: payload.fields.issuetype?.name ?? 'Task',
    url: `${baseUrl.replace(/\/+$/, '')}/browse/${payload.key}`,
  };
}
