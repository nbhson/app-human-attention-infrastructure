/**
 * `@harness/git-provider` — the Git-host read seam (review-reorient Phase 3).
 *
 * Public surface:
 * - `git-provider` — the `GitProvider` interface, `FetchPullRequestInput`,
 *   `GitProviderError`, `parseRepoPath`.
 * - `github-provider` — `GitHubProvider` (REST over `fetch`, no host SDK).
 * - `github-mapper` — the pure `mapGithubPullRequest` (fixtures-testable).
 * - `git-tool-map` — the per-host capability→tool-name table (`GitToolMap`,
 *   `StaticGitToolMap`).
 * - `mcp-git-mapper` — `mapMcpGitPullRequest` (ToolContent[] → `PullRequest`).
 * - `mcp-git-provider` — `MCPGitProvider` (fetch via MCP tools) + the
 *   `UnknownProviderHostError` for unroutable hosts.
 * - `head-sha` — `resolveHeadSha` + `cloneInputFromPullRequest` (validated
 *   head-SHA extraction, day-11).
 * - `clone` — `cloneAndCheckout` (shallow clone + detach-checkout-at-SHA),
 *   `CloneError`, and the injectable `RunGit` type (day-11).
 */

export * from './git-provider.js';
export * from './github-provider.js';
export * from './github-mapper.js';
export * from './git-tool-map.js';
export * from './mcp-git-mapper.js';
export * from './mcp-git-provider.js';
export * from './head-sha.js';
export * from './clone.js';
