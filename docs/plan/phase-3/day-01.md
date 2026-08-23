# Day 01 — `GitLabProvider`: REST Adapter for GitLab MR Fetch

| | |
|---|---|
| **Week** | 1 — Provider breadth |
| **Spec refs** | git-provider §2 (GitProvider seam), §4 (module layout); Architecture §7 (boundary rule) |
| **Estimated effort** | 6h |
| **Prerequisites** | Phase 2 complete (`v0.2.0-harness`); `GitHubProvider` + `parseRepoPath` ship in `@harness/git-provider` |

---

## 1. Objectives

By end of day you will have:

1. A `GitLabProvider` implementing the existing `GitProvider` seam — read-only MR fetch, no write primitives yet (write-back is Day 07).
2. A pure `gitlab-mapper.ts` that maps GitLab MR JSON → the shared `PullRequest` domain shape (same shape `GitHubProvider` already produces).
3. `parseRepoPath` extended to handle GitLab project paths (URL-encoded `/` in path, `.gitlab.com` host detection).
4. Fixture-tested mapping (`new_path`/`old_path` → `CREATED`/`MODIFIED`/`DELETED`/`RENAMED`) and a stubbed-fetch provider test — no live token.

The day establishes the **second provider impl** beside `GitHubProvider`; Days 02–03 add Bitbucket and the registry.

---

## 2. Design Decisions

### 2.1 GitLab calls a PR an "MR" — the seam must not leak that

`PullRequest` is host-agnostic. GitLab-specific noise (`iid` vs `id`, `draft` vs `WIP`, `target_branch` vs `base`) is confined to the mapper and the provider's URL builder — callers of `GitProvider` never see it.

```typescript
// packages/git-provider/src/gitlab-mapper.ts
export function mapGitlabMergeRequest(raw: GitlabMrPayload): PullRequest {
  return {
    id:           String(raw.iid),
    title:        raw.title,
    sourceBranch: raw.source_branch,
    targetBranch: raw.target_branch,
    author:       raw.author?.username,
    state:        raw.state,            // 'opened' | 'merged' | 'closed'
    draft:        raw.draft ?? raw.work_in_progress ?? false,
    files:        (raw.changes ?? []).map(mapGitlabFileChange),
    // ...
  };
}
```

### 2.2 Endpoints

- MR metadata: `GET /api/v4/projects/:id/merge_requests/:iid` — `:id` is the **URL-encoded** `owner/name` path (`acme%2Fapi`), the GitLab REST convention for project paths.
- File changes: `GET /api/v4/projects/:id/merge_requests/:iid/changes` (a single call returning `changes[]`), or `/versions/:version/diffs` if a specific revision is requested. Use `/changes` first; keep `fetchPullRequest` single-shot.
- Auth: `PRIVATE-TOKEN` header (personal/project token) — same "bearer-optional `config.token`" pattern as `GitHubProvider`; support `baseUrl` for self-hosted GitLab.

### 2.3 Error mapping

All transport failures become `GitProviderError` with an optional `status` (404 → "not found or insufficient permission", 401 → "bad token"), never a raw `fetch` throw.

---

## 3. Tasks

### 3.1 Provider skeleton (30 min)

- [ ] `packages/git-provider/src/gitlab-provider.ts` — `GitLabProvider implements GitProvider`; `type = 'gitlab'`.
- [ ] `packages/git-provider/src/gitlab-mapper.ts` — `mapGitlabMergeRequest`, raw payload subsets, `mapGitlabFileChange`.

### 3.2 `parseRepoPath` extension (45 min)

- [ ] Detect `gitlab.com` (or configured GitLab host) → return `{ host, owner, name }` with the project path slug.
- [ ] URL-encode the project path for the REST `:id` segment — unit-test `acme/sub/group/name` → `acme%2Fsub%2Fgroup%2Fname`.

### 3.3 Mapper fixtures (60 min)

- [ ] Fixture JSON for `added`/`modified`/`removed`/`renamed` MR changes.
- [ ] Fixture for `draft: true`, `work_in_progress: true`, and both-absent cases.

### 3.4 `fetchPullRequest` (75 min)

- [ ] `fetchPullRequest(input)` → `{ repo, number }` → metadata + `/changes` → `mapGitlabMergeRequest`.
- [ ] Stub `fetch` in tests; assert URL construction, `PRIVATE-TOKEN` header, and `GitProviderError` on 401/404.

### 3.5 Exports + boundary (30 min)

- [ ] Add `GitLabProvider`, mapper + payload types to `src/index.ts` and the README module table.
- [ ] Confirm `gitlab-provider.ts` imports only `@harness/domain` (grep check).

### 3.6 Tests (60 min)

- [ ] Mapper: all four change kinds map correctly; draft/WIP flags fold into the same boolean.
- [ ] Provider: URL encoding, header, and error wrapping (stubbed fetch).
- [ ] `gitlab` case added to the existing provider-type fixture.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/git-provider/src/gitlab-provider.ts` | `GitLabProvider` REST adapter (fetch only) |
| `packages/git-provider/src/gitlab-mapper.ts` | `mapGitlabMergeRequest` + payload types |
| `packages/git-provider/src/git-provider.ts` (updated) | `parseRepoPath` GitLab host/project handling |
| `packages/git-provider/src/__tests__/gitlab-*.test.ts` | Mapper + provider tests |
| `packages/git-provider/README.md` (updated) | Modules + "GitLab complete" status |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/git-provider test` — mapper + provider tests pass with fixtures only (no live token).
- [ ] `mapGitlabMergeRequest` returns a `PullRequest` indistinguishable in shape from `GitHubProvider` output.
- [ ] GitLab project paths are URL-encoded in the REST `:id` segment.
- [ ] 401/404 map to `GitProviderError` with the right status — never a raw throw.
- [ ] `grep -r "from '@harness" packages/git-provider/src` shows only `@harness/domain`.
- [ ] `pnpm lint` clean.

---

## 6. Notes & Pitfalls

- **Fetch only today.** Write primitives (`postComment`, `setStatus`, `createNote`) are Day 07 write-back — do not add them now or the seam gains a second responsibility before Day 06 defines `WriteBackService`.
- **MR ≠ PR field names.** `iid` (project-scoped) is the "number" users paste; the global `id` is different. Map on `iid`, keep it in `PullRequest.id`.
- **Path encoding is the classic GitLab bug.** Forgetting `encodeURIComponent` on the `owner/name` slug yields 404 on nested groups — the unit test on `acme%2Fsub%2Fgroup%2Fname` exists to catch it.
- **No live keys.** Match the repo's `.env.example` hygiene: token read from config, never committed, never logged.

---

*Next: [Day 02 — `BitbucketProvider`: REST Adapter for Bitbucket PR Fetch](day-02.md)*