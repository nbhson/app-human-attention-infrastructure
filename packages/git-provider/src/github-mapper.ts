/**
 * Pure mapper from the GitHub REST payloads to a normalised {@link PullRequest}
 * (review-reorient Phase 3). Kept separate from {@link GitHubProvider} so the
 * mapping can be unit-tested against fixtures without a live API call — the same
 * split used by `map-anthropic-response.ts`.
 */

import type {
  GitProviderType,
  PullRequest,
  PullRequestFile,
  PullRequestFileStatus,
} from '@harness/domain';

/** Subset of the GitHub PR object (`/repos/{owner}/{repo}/pulls/{number}`). */
export interface GithubPullPayload {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly user: { readonly login: string };
  readonly head: { readonly ref: string; readonly sha: string };
  readonly base: { readonly ref: string; readonly sha: string };
  readonly html_url: string;
}

/** Subset of a GitHub PR file (`/repos/{owner}/{repo}/pulls/{number}/files`). */
export interface GithubPrFilePayload {
  readonly filename: string;
  readonly status: 'added' | 'modified' | 'removed' | 'renamed';
  readonly additions: number;
  readonly deletions: number;
  readonly patch?: string | null;
}

const STATUS_MAP: Record<GithubPrFilePayload['status'], PullRequestFileStatus> = {
  added: 'CREATED',
  modified: 'MODIFIED',
  removed: 'DELETED',
  renamed: 'RENAMED',
};

function mapFile(file: GithubPrFilePayload): PullRequestFile {
  return {
    path: file.filename,
    status: STATUS_MAP[file.status],
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch ?? '',
  };
}

/**
 * Map a GitHub PR + its file list into a {@link PullRequest}. `repo` is the
 * `host/owner/name` slug, reconstructed from the host the provider served.
 */
export function mapGithubPullRequest(
  provider: GitProviderType,
  repo: string,
  meta: GithubPullPayload,
  files: GithubPrFilePayload[],
): PullRequest {
  return {
    provider,
    number: meta.number,
    title: meta.title,
    description: meta.body ?? '',
    author: meta.user.login,
    sourceBranch: meta.head.ref,
    targetBranch: meta.base.ref,
    base: { ref: meta.base.ref, sha: meta.base.sha, repo },
    head: { ref: meta.head.ref, sha: meta.head.sha, repo },
    url: meta.html_url,
    repo,
    files: files.map(mapFile),
  };
}
