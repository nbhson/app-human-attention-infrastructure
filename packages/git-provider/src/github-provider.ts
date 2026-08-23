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
import type { PullRequest } from '@harness/domain';

import { GitProviderError, parseRepoPath } from './git-provider.js';
import type { FetchPullRequestInput, GitProvider } from './git-provider.js';
import { mapGithubPullRequest } from './github-mapper.js';
import type { GithubPullPayload, GithubPrFilePayload } from './github-mapper.js';

export class GitHubProvider implements GitProvider {
  readonly type = GitProviderType.GitHub;

  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://api.github.com',
  ) {}

  async fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest> {
    const { owner, name } = parseRepoPath(input.repo);
    const prPath = `/repos/${owner}/${name}/pulls/${input.number}`;
    const [meta, files] = await Promise.all([
      this.request(prPath, 'GET'),
      this.request(`${prPath}/files`, 'GET'),
    ]);
    return mapGithubPullRequest(
      this.type,
      input.repo,
      meta as GithubPullPayload,
      files as GithubPrFilePayload[],
    );
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
    const pr = (await this.request(
      `/repos/${owner}/${name}/pulls/${input.number}`,
      'GET',
    )) as GithubPullPayload;
    await this.request(`/repos/${owner}/${name}/statuses/${pr.head.sha}`, 'POST', {
      state,
      description,
      context: 'harness/review',
    });
  }

  private async request(path: string, method: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'harness-review',
    };
    if (this.token.length > 0) {
      headers.Authorization = `Bearer ${this.token}`;
    }
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
}
