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

  /**
   * Clone the PR's repo into `workdir` and check out the **head SHA** the PR
   * proposes — on a detached, throwaway ref, never a branch (day-11 §2.1, §6).
   * Shallow (`--depth 1`) and wall-clock-bounded; the harness only ever reads
   * and runs this checkout, it never writes a commit.
   */
  cloneAndCheckout(input: CloneInput, workdir: string): Promise<CloneResult>;
}

/**
 * The resolved facts a clone needs (day-11 §2.2). Provider-neutral: the host
 * differences live in SHA/branch *resolution* (each provider's mapper), not in
 * the checkout — `git` is the same tool on every host.
 */
export interface CloneInput {
  /** `host/owner/name` repo slug, e.g. `github.com/acme/api`. */
  readonly repo: string;
  /** PR / MR number (for provenance and the throwaway ref name). */
  readonly number: number;
  /** The head commit SHA — the PR's merge candidate, never the source branch tip. */
  readonly headSha: string;
  /** The source branch name (recorded, used to seed the shallow clone). */
  readonly sourceBranch: string;
  /** The target branch name (recorded; never checked out). */
  readonly targetBranch: string;
}

/** The outcome of a shallow clone + head-SHA checkout (day-11 §2.2). */
export interface CloneResult {
  /** Absolute (or cwd-relative) path to the populated worktree. */
  readonly workdir: string;
  /** The head SHA actually checked out (echoed back for attributability). */
  readonly headSha: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
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
