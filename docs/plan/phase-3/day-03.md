# Day 03 — `MCPGitProvider`: Git MCP Tools → `PullRequest` Behind the `GitProvider` Seam

| | |
|---|---|
| **Week** | 1 — MCP connectivity |
| **Spec refs** | git-provider §2 (`GitProvider` seam), §4 (modules); Architecture §7 (boundary rule) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 02 (`mcp.config.json` + `McpServerRegistry`); Phase-1 `GitProvider` seam + `PullRequest` shape |

---

## 1. Objectives

By end of day you will have:

1. An `MCPGitProvider` implementing the existing `GitProvider` seam, but **not** by speaking GitHub/GitLab/Bitbucket REST — by calling whichever Git MCP server's tools resolve a PR/MR URL into a diff.
2. A host-agnostic tool resolver that picks the right MCP server from the URL (`github.com → github`, `gitlab.com → gitlab`, `bitbucket.org → bitbucket`) and issues a `tools/call` for "get pull request" + "get changed files".
3. A pure mapper (`mcp-git-mapper.ts`) that maps MCP tool `ToolContent` → the shared `PullRequest` domain shape already produced by the Phase-1 `GitHubProvider`.
4. Fixture-tested mapping + a stubbed-`McpClient` provider test — no live server, no live token.

The day proves "add GitLab/Bitbucket" is a config entry + a tool-name mapping, not a new REST adapter — the whole point of the MCP switch.

---

## 2. Design Decisions

### 2.1 The seam stays; the transport changes

Phase 1 shipped `GitProvider` with a `GitHubProvider` (REST). Phase 3 does **not** add `GitLabProvider`/`BitbucketProvider` REST classes. It adds a single `MCPGitProvider` that fronts *any* Git MCP server. The `PullRequest` type is untouched, so nothing downstream changes.

```typescript
// packages/git-provider/src/mcp-git-provider.ts
export class MCPGitProvider implements GitProvider {
  constructor(private registry: McpServerRegistry, private toolMap: GitToolMap) {}
  async fetchPullRequest(input: FetchInput): Promise<PullRequest> { /* … */ }
  // read-only today; write primitives land in Day 06 via the same MCP tools
}
```

### 2.2 A per-host tool map, not a per-host class

Git MCP servers vary in tool names (`get_pull_request` vs `mr_get` vs `pullrequest:get`) but all expose the same *capabilities*. `GitToolMap` binds capability → tool name per server:

```typescript
interface GitToolMap {
  resolve(host: GitHost): { getPrTool: string; getFilesTool: string; args(args: FetchInput): Record<string, unknown> };
}
```

One small table entry per host is the *entire* "adapter". A new Git forge = one row, not a package.

### 2.3 URL → host is the only routing logic

`parseRepoPath(url)` (already in `@harness/git-provider`) yields the host; the provider asks the registry for that host's client and calls its mapped tools. Unsupported host / missing config entry → `UnknownProviderHostError`.

### 2.4 Mapper flattens `ToolContent`, never trusts a single text blob

The get-PR and get-files tools return structured content. The mapper assembles `PullRequest` (title, source/target branch, author, state, draft, `files[]` with `changeKind`) from the content array, and raises `GitProviderError` on a missing/incompatible field — the same defensive posture the REST mappers had.

---

## 3. Tasks

### 3.1 `GitToolMap` (60 min)

- [ ] `packages/git-provider/src/git-tool-map.ts` — capability→tool-name rows for github/gitlab/bitbucket + `resolve(host)`.
- [ ] Fixture: each host's expected tool names.

### 3.2 `MCPGitProvider` (90 min)

- [ ] `fetchPullRequest(input)` → host from `parseRepoPath` → registry client → `tools/call(getPr)` + `tools/call(getFiles)` → mapper.
- [ ] `UnknownProviderHostError` on unconfigured/missing host; `GitProviderError` on `ToolResult.isError`.

### 3.3 `mcp-git-mapper.ts` (75 min)

- [ ] Flatten `ToolContent[]` → `PullRequest`; map file-status tokens to `CREATED`/`MODIFIED`/`DELETED`/`RENAMED`.
- [ ] Missing-field and malformed-content → `GitProviderError`.

### 3.4 Stubbed-provider test (75 min)

- [ ] A fake `McpClient` returning fixture `ToolResult`s; assert the right tool names were called with the right args (URL parsed → repo/number).
- [ ] Error-path: `isError` result → `GitProviderError`; unknown host → throw.

### 3.5 Exports + boundary (45 min)

- [ ] `src/index.ts` + README module table gain `MCPGitProvider` + mapper.
- [ ] `grep -r "from '@harness" packages/git-provider/src` → `@harness/domain` + `@harness/mcp` only (mcp is a shared seam, not an engine).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/git-provider/src/mcp-git-provider.ts` | `MCPGitProvider` (fetch via MCP tools) |
| `packages/git-provider/src/git-tool-map.ts` | Capability→tool-name per host |
| `packages/git-provider/src/mcp-git-mapper.ts` | `ToolContent[]` → `PullRequest` |
| `packages/git-provider/src/__tests__/mcp-git-*.test.ts` | Stubbed `McpClient` tests |
| `packages/git-provider/README.md` (updated) | Modules + "MCP-backed GitProvider" status |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/git-provider test` — green with a stubbed `McpClient` and fixtures (no live server/token).
- [ ] `mapGitToolPullRequest` returns a `PullRequest` structurally identical to Phase-1 `GitHubProvider` output.
- [ ] The provider calls the mapped tool names for github/gitlab/bitbucket with repo/number parsed from the URL.
- [ ] Unsupported host → `UnknownProviderHostError`; `ToolResult.isError` → `GitProviderError` (never a raw throw).
- [ ] `grep -r "from '@harness" packages/git-provider/src` shows only `@harness/domain` + `@harness/mcp`.
- [ ] No REST `fetch` call into a GitHub/GitLab/Bitbucket endpoint anywhere in the new code.

---

## 6. Notes & Pitfalls

- **Tool names are the new per-host surface.** GitLab's MCP server may call it `get_merge_request`, not `get_pull_request` — the `GitToolMap` is where that lives. Do **not** start special-casing host strings inside the provider.
- **One provider, not three.** Resist the urge to split `MCPGitProvider` into per-host subclasses "for clarity" — that's the REST-era shape creeping back. The tool map already isolates per-host variance.
- **Mapping failures must be loud.** If a server returns an unexpected content shape, `GitProviderError` (not a silently-empty `files[]`) — a review of "no files changed" must never be a mapping bug dressed up as truth.
- **Write primitives are out today.** `postComment`/`setStatus` are the write-back week (Day 06) over the same MCP tools — don't add them to the seam now.
- **Tomorrow (Day 04):** `MCPTicketProvider` — Jira MCP tools → `Issue` + comment/transition.

---

*Next: [Day 04 — `MCPTicketProvider`: Jira MCP Tools → `Issue` + Comment/Transition](day-04.md)*