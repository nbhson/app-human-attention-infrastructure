# @harness/git-provider — Git Host Read Seam

The provider seam that reads an external pull request / merge request from a Git
host, so the AI reviewer has a diff to review — and, for the write-back path,
maps write capabilities to the same host's MCP tools.

**Status:** v1.0-candidate (as-built) — pending Day 40 exit review ·
**Boundary rule:** depends only on `@harness/domain`; never an engine, host SDK, or event-bus.

---

## Purpose

1. **Define the `GitProvider` seam** — fetch PR metadata + a per-file diff.
2. **Provide a GitHub REST implementation** — `GitHubProvider` over the built-in
   `fetch`, no `octokit` (the direct REST path).
3. **Front every host through MCP** — `MCPGitProvider` routes the pasted repo slug to
   the right host's MCP tools via `GitToolMap`, so GitHub/GitLab/Bitbucket are
   served from **one `mcp.config.json`** — there is no per-host REST adapter.
4. **Map host JSON → domain `PullRequest`** — via pure, fixture-testable mappers
   (REST and MCP ToolContent variants).
5. **Support clone-and-test** — `resolveHeadSha` + `cloneAndCheckout` turn a fetched
   PR into a shallow, detached-checkout-at-head-SHA worktree.

```text
   POST /api/reviews { prUrl }
            │
            ▼
   resolveReviewInput → MCPGitProvider.fetchPullRequest({ repo, number })
            │
            ▼
   PullRequest { metadata + files[].patch }  →  AI reviewer
```

## Interface

```typescript
interface GitProvider {
  readonly type: GitProviderType;
  fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest>;
}
```

- `FetchPullRequestInput.repo` is the `host/owner/name` slug (e.g. `github.com/acme/api`),
  split by `parseRepoPath` into host-specific segments.
- Errors are always `GitProviderError` (with optional `status`) or
  `UnknownProviderHostError` (an unconfigured host), never thrown raw.

## Host matrix (multi-host via MCP)

| Host | Read path |
| --- | --- |
| `github` | `GitHubProvider` (REST) when not MCP-connected; `MCPGitProvider` via `github` MCP server otherwise. |
| `gitlab` | `MCPGitProvider` via the `gitlab` MCP server. |
| `bitbucket` | `MCPGitProvider` via the `bitbucket` MCP server. |

The per-host variance (tool names like `get_pull_request` vs `get_merge_request`,
argument keys like `pull_number` vs `merge_request_iid`) lives entirely in
`GitToolMap` — adding a forge is a table row, never a new adapter class.

## Modules

| Module | What it provides |
| --- | --- |
| `git-provider.ts` | `GitProvider`, `FetchPullRequestInput`, `GitProviderError`, `parseRepoPath`. |
| `github-provider.ts` | `GitHubProvider` — bearer-token REST; `baseUrl` defaults to `https://api.github.com`. |
| `github-mapper.ts` | `mapGithubPullRequest` + the raw GitHub payload subsets, pure and fixtures-testable. |
| `git-tool-map.ts` | `GitToolMap` / `StaticGitToolMap` — per-host capability→tool-name + arg-encoding table (read + write). |
| `mcp-git-mapper.ts` | `mapMcpGitPullRequest` — `ToolContent[]` → `PullRequest`. |
| `mcp-git-provider.ts` | `MCPGitProvider` — fetch via MCP tools; `UnknownProviderHostError`. |
| `head-sha.ts` | `resolveHeadSha` + `cloneInputFromPullRequest` — validated head-SHA extraction. |
| `clone.ts` | `cloneAndCheckout` (shallow clone + detach-checkout-at-SHA), `CloneError`, injectable `RunGit`. |

## Test strategy

- The mappers are tested against fixture JSON / `ToolContent[]` (status →
  `CREATED`/`MODIFIED`/`DELETED`/`RENAMED`).
- The provider's `fetch`/MCP client is stubbed in tests; no live token is required
  (and none is committed — same `.env.example` hygiene as the rest of the repo).
- `head-sha`/`clone` assert the exact `git` command sequence with an injected
  `RunGit`, no real binary.

## Directory structure

```
src/
├── index.ts
├── git-provider.ts
├── github-provider.ts / github-mapper.ts
├── git-tool-map.ts
├── mcp-git-mapper.ts / mcp-git-provider.ts
├── head-sha.ts
└── clone.ts
```

## Public API surface

```typescript
// GitProvider, FetchPullRequestInput, GitProviderError, parseRepoPath,
// GitHubProvider, mapGithubPullRequest, GitToolMap, StaticGitToolMap,
// mapMcpGitPullRequest, MCPGitProvider, UnknownProviderHostError,
// resolveHeadSha, cloneInputFromPullRequest, cloneAndCheckout, CloneError
```

## Dependency rule

```
packages/git-provider → imports only @harness/domain
```

The REST `GitHubProvider` remains only as the direct read path; GitLab/Bitbucket
route through the MCP layer, not additional REST adapters.