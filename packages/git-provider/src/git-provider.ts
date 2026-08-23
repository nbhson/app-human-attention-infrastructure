/**
 * The `GitProvider` seam (review-reorient Phase 3) — the *only* place the harness
 * reads from a Git host (and, in a later phase, writes review comments/status back).
 *
 * A provider translates "fetch this repo's PR/MR number N" into a normalised
 * {@link PullRequest} (metadata + per-file diff). Nothing outside this package
 * knows which host backed the call; the boundary linter keeps host SDKs leaking
 * past this package. Depends only on `@harness/domain`.
 */

import type { PullRequest } from '@harness/domain';

/** Which PR/MR to fetch, from a host the provider already knows how to reach. */
export interface FetchPullRequestInput {
  /** The repo host path, e.g. `github.com/acme/api`. */
  readonly repo: string;
  /** PR / MR number on the host. */
  readonly number: number;
}

/**
 * The narrow git-host surface the review slice depends on.
 *
 * Note: the seam carries no single `type` — one provider (the MCP-backed one,
 * Day 03) fronts *any* Git host, so the actual host is resolved per-request and
 * stamped onto {@link PullRequest.provider}. A single-host provider like
 * `GitHubProvider` still declares its own `type` for its internal mapper.
 */
export interface GitProvider {
  /** Fetch the PR metadata + diff. */
  fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest>;

  /** Post a review comment (used by the optional write-back path). */
  postComment(input: FetchPullRequestInput, body: string): Promise<void>;

  /** Set a commit/PR status (used by the optional write-back path). */
  setStatus(
    input: FetchPullRequestInput,
    state: 'pending' | 'success' | 'failure',
    description: string,
  ): Promise<void>;
}

/** A git-host request failed for any reason (auth, network, not-found, rate-limit). */
export class GitProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'GitProviderError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Split a `host/owner/name` repo path into its parts. Used by every provider to
 * turn the human-facing repo slug into the host-specific API path segments.
 */
export function parseRepoPath(repo: string): { host: string; owner: string; name: string } {
  const parts = repo.split('/');
  if (parts.length < 3) {
    throw new GitProviderError(`repo path must be "host/owner/name", got "${repo}"`);
  }
  const host = parts[0]!;
  const name = parts[parts.length - 1]!;
  const owner = parts.slice(1, -1).join('/');
  return { host, owner, name };
}
