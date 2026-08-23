/**
 * `@harness/git-provider` — the Git-host read seam (review-reorient Phase 3).
 *
 * Public surface:
 * - `git-provider` — the `GitProvider` interface, `FetchPullRequestInput`,
 *   `GitProviderError`, `parseRepoPath`.
 * - `github-provider` — `GitHubProvider` (REST over `fetch`, no host SDK).
 * - `github-mapper` — the pure `mapGithubPullRequest` (fixtures-testable).
 */

export * from './git-provider.js';
export * from './github-provider.js';
export * from './github-mapper.js';
