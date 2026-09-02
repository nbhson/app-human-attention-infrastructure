/**
 * `resolveReviewInput` (Phase 3 day-05) — the one facade the reviews route calls
 * to turn a pasted PR URL (+ optional Jira key) into unified
 * `{ pullRequest, issue }`, with *no* per-host REST adapter.
 *
 * The MCP thesis, made concrete: a single {@link McpServerRegistry} (one
 * `mcp.config.json`) fronts every Git host and ticket system. `parsePrUrl`
 * resolves the pasted URL to a `host/owner/name` repo slug; {@link MCPGitProvider}
 * routes that slug to the right host's MCP tools; {@link MCPTicketProvider}
 * fetches the Jira issue for the key. Nothing in `apps/api` imports a
 * GitHubProvider/GitLabProvider/BitbucketProvider/JiraProvider class — those
 * REST adapters are the Phase-1 path, exercised only where a host is *not* MCP-
 * connected (day-05 §2.2).
 */

import type { Issue, PullRequest } from '@harness/domain';
import type { McpServerRegistry } from '@harness/mcp';
import { MCPGitProvider, StaticGitToolMap } from '@harness/git-provider';
import { MCPTicketProvider, StaticTicketToolMap } from '@harness/ticket-provider';

/** A review-input request failed for a user-correctable reason (bad URL, unknown host). */
export class ReviewInputError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ReviewInputError';
  }
}

/** A pasted PR URL parsed into the `host/owner/name` slug + PR number. */
export interface ParsedPrUrl {
  readonly repo: string;
  readonly number: number;
}

/** The review route's raw input. */
export interface ResolveReviewInputRequest {
  readonly prUrl: string;
  /** Jira issue key, e.g. `ACME-1234`. Optional. */
  readonly jiraKey?: string;
}

/** The unified result the review route builds a report from. */
export interface ResolvedReviewInput {
  readonly pullRequest: PullRequest;
  readonly issue?: Issue;
}

/** The single registry that fronts every host, plus the Jira site root. */
export interface ResolveReviewInputOptions {
  readonly registry: McpServerRegistry;
  /** Jira site root (e.g. `https://acme.atlassian.net`), used for the issue url. */
  readonly jiraBaseUrl?: string;
}

/** Normalise a URL host to the canonical token the tool maps key on (lower, no `www.`). */
function canonicalHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Parse a GitHub / GitLab / Bitbucket PR/MR web URL into the repo slug +
 * number the {@link MCPGitProvider} seam expects. Each forge's URL shape is
 * handled here; an unrecognised host is a clear 400 rather than a silent
 * anonymous request.
 */
export function parsePrUrl(prUrl: string): ParsedPrUrl {
  let url: URL;
  try {
    url = new URL(prUrl);
  } catch {
    throw new ReviewInputError(`"${prUrl}" is not a valid URL`, 400);
  }
  const host = canonicalHost(url.host);
  const path = url.pathname;

  if (host === 'github.com') {
    // github.com/owner/name/pull/123
    const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(path);
    if (!m) {
      throw new ReviewInputError(`"${prUrl}" is not a GitHub pull-request URL`, 400);
    }
    return { repo: `github.com/${m[1]}/${m[2]}`, number: Number(m[3]) };
  }

  if (host === 'gitlab.com') {
    // gitlab.com/group/.../project/-/merge_requests/7
    const m = /^\/(.+)\/-\/merge_requests\/(\d+)\/?$/.exec(path);
    if (!m) {
      throw new ReviewInputError(`"${prUrl}" is not a GitLab merge-request URL`, 400);
    }
    return { repo: `gitlab.com/${m[1]}`, number: Number(m[2]) };
  }

  if (host === 'bitbucket.org') {
    // bitbucket.org/workspace/repo/pull-requests/3
    const m = /^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/?$/.exec(path);
    if (!m) {
      throw new ReviewInputError(`"${prUrl}" is not a Bitbucket pull-request URL`, 400);
    }
    return { repo: `bitbucket.org/${m[1]}/${m[2]}`, number: Number(m[3]) };
  }

  throw new ReviewInputError(`unsupported Git host "${host}" (expected github.com, gitlab.com, or bitbucket.org)`, 400);
}

/**
 * Resolve a review request against the MCP registry: fetch the PR/MR from its
 * host and, when a Jira key is present, the requirement ticket. Returns a
 * unified `{ pullRequest, issue }` — the only call site the reviews route needs.
 */
export async function resolveReviewInput(
  request: ResolveReviewInputRequest,
  options: ResolveReviewInputOptions,
): Promise<ResolvedReviewInput> {
  const { repo, number } = parsePrUrl(request.prUrl);

  const gitProvider = new MCPGitProvider(options.registry, new StaticGitToolMap());
  const pullRequest = await gitProvider.fetchPullRequest({ repo, number });

  let issue: Issue | undefined;
  if (request.jiraKey !== undefined) {
    const ticketProvider = new MCPTicketProvider(
      options.registry,
      new StaticTicketToolMap(),
      options.jiraBaseUrl ?? 'https://acme.atlassian.net',
    );
    issue = await ticketProvider.fetchIssue({ key: request.jiraKey });
  }

  return { pullRequest, ...(issue === undefined ? {} : { issue }) };
}
