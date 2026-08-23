# Day 08 — GitProvider seam + GitHubProvider (fetch PR diff/metadata)

| | |
|---|---|
| **Week** | W2 — Review ingest core |
| **Spec refs** | Spec 1 §5 (replaceable integrations), §7 (boundary R13) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 07 (bootable API + provider seams stubbed) |

---

## 1. Objectives

- Define the read-only `GitProvider` seam (`fetchPullRequest`) returning a PR diff + metadata (title, base/head refs, author, files) for any host.
- Implement `GitHubProvider` against the GitHub REST API using a token from config.
- Parse the diff into structured per-file hunks the reviewer can consume (no write path exists).
- Enforce **R13**: `@harness/git-provider` imports only `@harness/domain`, and test with a recorded-fixture transport (no live network in unit tests).

## 2. Design Decisions

- **Read-first**: `fetchPullRequest` is the only operation; there is **no** `applyAndCommit`, push, comment, or merge surface in Phase 1. The AI and the harness never write to the repository.

```ts
export interface GitProvider {
  readonly kind: GitProviderType;                // 'GITHUB'
  fetchPullRequest(url: PrUrl): Promise<PullRequest>;
}
export interface PullRequest {
  readonly url: string;
  readonly title: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly author: string;
  readonly diff: Diff;                            // structured hunks
}
```

- `GitHubProvider` takes an injected HTTP client so tests can replay recorded fixtures; the token is injected via config, never hard-coded (full hygiene on Day 27).
- GitLab/Bitbucket are **not** built now (Phase 3); the seam exists so they plug in later without touching the ingest path.

## 3. Tasks

### 3.1 Domain types (60 min)
- [ ] `PrUrl` parsing (owner/repo/number) + `Diff`/`Hunk` value types in `@harness/domain`

### 3.2 Seam + GitHub impl (180 min)
- [ ] `packages/git-provider/src/git-provider.ts` interface
- [ ] `packages/git-provider/src/github/github-provider.ts` REST fetch + diff parse
- [ ] Fixture transport + recorded GitHub responses

### 3.3 Boundary + tests (150 min)
- [ ] R13 architecture assertion (imports only `@harness/domain`)
- [ ] Unit tests: PR URL parsing, diff parsing, metadata mapping, error mapping (404/rate-limit)

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/git-provider/src/git-provider.ts` | `GitProvider` seam + `PullRequest` |
| `packages/git-provider/src/github/github-provider.ts` | GitHub REST implementation |
| `packages/git-provider/src/github/pr-url.ts` | PR URL parser |
| `fixtures/github/pr-diff.json` | Recorded fixture for tests |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/git-provider test` passes on fixtures only (no network)
- [ ] A GitHub PR URL parses to `{owner, repo, number}` and `fetchPullRequest` returns `title` + a structured diff
- [ ] R13 test confirms the package imports nothing but `@harness/domain`
- [ ] A 404 / rate-limit response surfaces a typed `GitProviderError`

## 6. Notes & Pitfalls

- Keep the diff parser tolerant of unified/context quirks; empty diffs and binary files must not crash ingest.
- The provider returns data; it does not decide anything — review semantics belong to `ReviewAgent` (Day 11).

---

*Next: [Day 09 — TicketProvider seam + JiraProvider (fetch issue)](day-09.md)*