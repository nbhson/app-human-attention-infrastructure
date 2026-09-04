/**
 * `GitHubProvider` (review-reorient Phase 3) — the GitHub-backed
 * {@link GitProvider}, using the REST API over `fetch` (node ≥ 18 built-in; no
 * SDK dependency).
 *
 * Read path (Phase 3 core) is {@link fetchPullRequest}; the write path
 * (`postComment`/`setStatus`) backs the later, toggle-guarded write-back feature
 * and is included now so the seam contract is complete.
 */

import { GitProviderType } from '@harness/domain';
import type { PullRequest, PullRequestCommit, PullRequestCheckStatus, PullRequestCheck } from '@harness/domain';

import { GitProviderError, parseRepoPath } from './git-provider.js';
import type { CloneInput, CloneResult, FetchPullRequestInput, GitProvider } from './git-provider.js';
import { cloneAndCheckout } from './clone.js';
import { mapGithubPullRequest } from './github-mapper.js';
import type { GithubPullPayload, GithubPrFilePayload } from './github-mapper.js';

/**
 * GitHub's "list pull request files" endpoint returns **at most** this many files,
 * whatever `per_page`/pagination is used — an external ceiling, not a harness choice.
 * PRs beyond it must widen to the compare endpoint (see {@link GitHubProvider}).
 */
const GITHUB_PR_FILES_HARD_CAP = 300;

/**
 * Return the relative path of the next page from a GitHub `Link` response header,
 * or `null` when there is no further page. A page's `rel="next"` link is absolute
 * (e.g. `https://api.github.com/repos/o/r/pulls/1/files?page=2&per_page=100`); it is
 * reduced to `pathname + search` so the next `fetch` goes back through `baseUrl`.
 */
export function nextPagePath(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  for (const part of linkHeader.split(',')) {
    const relMatch = /rel="([^"]+)"/.exec(part);
    if (relMatch === null || relMatch[1] !== 'next') {
      continue;
    }
    const urlMatch = /<([^>]+)>/.exec(part);
    if (urlMatch === null) {
      continue;
    }
    const next = new URL(urlMatch[1]!);
    return next.pathname + next.search;
  }
  return null;
}

export class GitHubProvider implements GitProvider {
  readonly type = GitProviderType.GitHub;

  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://api.github.com',
  ) {}

  async fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest> {
    const { owner, name } = parseRepoPath(input.repo);
    const prPath = `/repos/${owner}/${name}/pulls/${input.number}`;
    const meta = (await this.request(prPath, 'GET')) as GithubPullPayload;

    // The PR-files endpoint is GitHub's canonical "Files changed" view, but it
    // pages at 30 by default and caps at GITHUB_PR_FILES_HARD_CAP total. Paginate
    // the whole chain (per_page=100) so every changed file is fetched; only when
    // the endpoint hits its hard cap are we forced to widen to the compare
    // endpoint (which reports up to 3000 files). No self-imposed limit anywhere.
    const pagedFiles = (await this.requestAllArrayPages(`${prPath}/files`)) as GithubPrFilePayload[];
    let files = pagedFiles;
    if (pagedFiles.length >= GITHUB_PR_FILES_HARD_CAP) {
      const compareFiles = await this.fetchCompareFiles(owner, name, meta.base.sha, meta.head.sha, pagedFiles);
      // Keep whichever list is larger: a successful compare should exceed the
      // capped page; a merge-base divergence must never under-count the cap.
      files = compareFiles.length >= pagedFiles.length ? compareFiles : pagedFiles;
    }

    // Fetch commits (up to 50)
    const commits = await this.fetchCommits(owner, name, input.number);

    // Fetch check status for the head commit
    const checkStatus = await this.fetchCheckStatus(owner, name, meta.head.sha);

    return mapGithubPullRequest(this.type, input.repo, meta, files, commits, checkStatus);
  }

  private async fetchCommits(owner: string, name: string, number: number): Promise<PullRequestCommit[]> {
    try {
      const commitsPath = `/repos/${owner}/${name}/pulls/${number}/commits`;
      const commitsData = (await this.requestAllArrayPages(commitsPath)) as Array<{
        sha: string;
        commit: { message: string | null; author: { name: string; date: string } };
        author: { login: string } | null;
        html_url: string;
      }>;
      return commitsData.slice(0, 50).map((c) => {
        const rawMessage = c.commit.message;
        const msg = rawMessage === null ? '' : rawMessage;
        const message = msg.split('\n')[0];
        return {
          sha: c.sha,
          message: message as string,
          author: c.author?.login ?? c.commit.author.name,
          authorDate: c.commit.author.date,
          url: c.html_url,
        } as PullRequestCommit;
      });
    } catch {
      return [];
    }
  }

  private async fetchCheckStatus(
    owner: string,
    name: string,
    headSha: string,
  ): Promise<PullRequestCheckStatus | undefined> {
    try {
      const checksPath = `/repos/${owner}/${name}/commits/${headSha}/check-runs`;
      const checksData = (await this.request(checksPath, 'GET')) as {
        check_runs: Array<{
          name: string;
          status: string;
          conclusion: string | null;
          html_url: string;
          started_at: string | null;
          completed_at: string | null;
        }>;
      };
      const checks = checksData.check_runs;
      if (checks.length === 0) {
        // Try statuses API as fallback
        return this.fetchStatuses(owner, name, headSha);
      }
      const passed = checks.filter((c) => c.conclusion === 'success').length;
      const failed = checks.filter((c) => c.conclusion === 'failure').length;
      const pending = checks.filter(
        (c) => c.status === 'in_progress' || c.status === 'queued' || c.status === 'pending',
      ).length;
      let state: PullRequestCheckStatus['state'] = 'neutral';
      if (pending > 0) state = 'pending';
      else if (failed > 0) state = 'failure';
      else if (passed > 0) state = 'success';

      return {
        state,
        totalCount: checks.length,
        passedCount: passed,
        failedCount: failed,
        pendingCount: pending,
        checks: checks.map((c) => ({
          name: c.name,
          status: c.status as PullRequestCheck['status'],
          conclusion: c.conclusion as PullRequestCheck['conclusion'],
          url: c.html_url,
          startedAt: c.started_at,
          completedAt: c.completed_at,
        })),
      };
    } catch {
      return this.fetchStatuses(owner, name, headSha);
    }
  }

  private async fetchStatuses(owner: string, name: string, sha: string): Promise<PullRequestCheckStatus | undefined> {
    try {
      const statusesPath = `/repos/${owner}/${name}/commits/${sha}/statuses`;
      const statusesData = (await this.request(statusesPath, 'GET')) as Array<{
        state: 'pending' | 'success' | 'failure' | 'error';
        context: string;
        target_url: string | null;
        created_at: string;
      }>;
      if (statusesData.length === 0) return undefined;
      const passed = statusesData.filter((s) => s.state === 'success').length;
      const failed = statusesData.filter((s) => s.state === 'failure' || s.state === 'error').length;
      const pending = statusesData.filter((s) => s.state === 'pending').length;
      let state: PullRequestCheckStatus['state'] = 'neutral';
      if (pending > 0) state = 'pending';
      else if (failed > 0) state = 'failure';
      else if (passed > 0) state = 'success';

      return {
        state,
        totalCount: statusesData.length,
        passedCount: passed,
        failedCount: failed,
        pendingCount: pending,
        checks: statusesData.map((s) => ({
          name: s.context,
          status: s.state === 'pending' ? 'pending' : ('success' as const),
          conclusion:
            s.state === 'success'
              ? 'success'
              : s.state === 'failure'
                ? 'failure'
                : s.state === 'error'
                  ? 'failure'
                  : 'neutral',
          url: s.target_url ?? '',
          startedAt: s.created_at,
          completedAt: s.state !== 'pending' ? s.created_at : null,
        })),
      };
    } catch {
      return undefined;
    }
  }

  async postComment(input: FetchPullRequestInput, body: string): Promise<void> {
    const { owner, name } = parseRepoPath(input.repo);
    await this.request(`/repos/${owner}/${name}/issues/${input.number}/comments`, 'POST', { body });
  }

  async setStatus(
    input: FetchPullRequestInput,
    state: 'pending' | 'success' | 'failure',
    description: string,
  ): Promise<void> {
    const { owner, name } = parseRepoPath(input.repo);
    const pr = (await this.request(`/repos/${owner}/${name}/pulls/${input.number}`, 'GET')) as GithubPullPayload;
    await this.request(`/repos/${owner}/${name}/statuses/${pr.head.sha}`, 'POST', {
      state,
      description,
      context: 'harness/review',
    });
  }

  async cloneAndCheckout(input: CloneInput, workdir: string): Promise<CloneResult> {
    // Clone + head-SHA checkout is host-agnostic; auth for private repos is the
    // caller's concern (the sandbox wiring lands Day 12), not this seam's.
    return cloneAndCheckout(input, workdir);
  }

  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'harness-review',
    };
    if (this.token.length > 0) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async request(path: string, method: string, body?: unknown): Promise<unknown> {
    const headers = this.baseHeaders();
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new GitProviderError(
        `github ${method} ${path} failed: ${response.status} ${response.statusText}`,
        response.status,
      );
    }
    return response.json();
  }

  /** GET one page, returning its parsed JSON plus the relative path of the next page. */
  private async requestPage(path: string): Promise<{ data: unknown; next: string | null }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.baseHeaders(),
    });
    if (!response.ok) {
      throw new GitProviderError(
        `github GET ${path} failed: ${response.status} ${response.statusText}`,
        response.status,
      );
    }
    return { data: await response.json(), next: nextPagePath(response.headers.get('link')) };
  }

  /** Follow GitHub's `rel="next"` chain and flatten an array-typed endpoint's pages. */
  private async requestAllArrayPages(path: string): Promise<unknown[]> {
    const out: unknown[] = [];
    const separator = path.includes('?') ? '&' : '?';
    let current: string | null = `${path}${separator}per_page=100`;
    while (current) {
      const { data, next } = await this.requestPage(current);
      if (Array.isArray(data)) {
        out.push(...data);
      }
      current = next;
    }
    return out;
  }

  /**
   * Get the full changed-file list via the compare endpoint (`/compare/{base}...{head}`),
   * which escapes the PR-files endpoint's 300-file cap (compare reports up to 3000).
   * Accumulates each page's `files` array. On any failure, returns the already-fetched
   * PR-files list so a review still yields a non-empty file set rather than nothing.
   */
  private async fetchCompareFiles(
    owner: string,
    name: string,
    baseSha: string,
    headSha: string,
    fallback: GithubPrFilePayload[],
  ): Promise<GithubPrFilePayload[]> {
    try {
      const basePath = `/repos/${owner}/${name}/compare/${baseSha}...${headSha}`;
      const files: GithubPrFilePayload[] = [];
      let current: string | null = `${basePath}?per_page=100`;
      while (current) {
        const { data, next } = await this.requestPage(current);
        const page = (data as { readonly files?: unknown }).files;
        if (Array.isArray(page)) {
          files.push(...(page as GithubPrFilePayload[]));
        }
        current = next;
      }
      return files;
    } catch {
      return fallback; // compare unavailable (e.g. divergent history) — keep the capped list
    }
  }
}
