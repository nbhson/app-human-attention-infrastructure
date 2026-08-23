# Day 02 — `BitbucketProvider`: REST Adapter for Bitbucket PR Fetch

| | |
|---|---|
| **Week** | 1 — Provider breadth |
| **Spec refs** | git-provider §2 (GitProvider seam), §4 (module layout); Architecture §7 (boundary rule) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 01 (`GitLabProvider` + `parseRepoPath` extension in `@harness/git-provider`) |

---

## 1. Objectives

By end of day you will have:

1. A `BitbucketProvider` implementing `GitProvider` — read-only PR fetch for Bitbucket Cloud (workspace/repo model).
2. A pure `bitbucket-mapper.ts` that maps Bitbucket PR JSON → `PullRequest` (paginated diff vs GitLab's single `/changes`, Bitbucket's `type`-tagged diffs).
3. `parseRepoPath` extended to Bitbucket URLs (`bitbucket.org/workspace/repo`).
4. Fixture-tested mapping and a stubbed-fetch provider test covering bitbucket auth (`Bearer` token, workspace-qualified endpoint).

Completes the "all three Git providers fetch a PR/MR" slice before the Day 03 registry.

---

## 2. Design Decisions

### 2.1 Bitbucket's REST shape is the odd one out

GitHub → per-file patch pre-computed; GitLab → one `/changes` call; **Bitbucket → paginated diff + per-file `type` tags** (`added_file`, `modified_file`, `removed_file`, `renamed_file`, `deleted_file`). The provider has to walk pagination and assemble the file list itself — the mapper stays pure and host-shaped.

### 2.2 Endpoints (Bitbucket Cloud API 2.0)

- PR metadata: `GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{id}`.
- Diff: `GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{id}/diffstat` for the file set, then `GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{id}/diff` with `pagelen` + next-page cursor for content.
- Auth: `Authorization: Bearer <token>` (workspace app password or OAuth). Support `baseUrl` for Bitbucket Server/Data Center later (today: Cloud).

### 2.3 Mapping `type` tags → change kind

`added_file` → `CREATED`, `renamed_file` → `RENAMED` (carry old+new path), `modified_file` → `MODIFIED`, `removed_file`/`deleted_file` → `DELETED`. Bitbucket's `type` field on the *file* (not its diffstat) is the source of truth; `diffstat` only has `lines_added`/`lines_removed`.

### 2.4 Pagination is the only new machinery

Keep `walkPaginated(nextUrl)` private to the provider: it follows the `next` link until exhausted and flattens results, so the mapper and callers see one array.

---

## 3. Tasks

### 3.1 Provider skeleton (30 min)

- [ ] `packages/git-provider/src/bitbucket-provider.ts` — `BitbucketProvider implements GitProvider`; `type = 'bitbucket'`.
- [ ] `packages/git-provider/src/bitbucket-mapper.ts` — `mapBitbucketPullRequest`, payload subsets, `mapBitbucketFileChange`.

### 3.2 `parseRepoPath` extension (30 min)

- [ ] Detect `bitbucket.org` → `{ host, workspace, repoSlug }`; unit-test `bitbucket.org/acme/api`.

### 3.3 Pagination helper (45 min)

- [ ] `walkPaginated` following `values[]` + `next` cursor; flatten; bound page count (safety cap).
- [ ] Unit test against a two-page fixture.

### 3.4 Mapper fixtures + mapping (60 min)

- [ ] Fixtures for all five `type` tags + a renamed file with `old`/`new` path.

### 3.5 `fetchPullRequest` (60 min)

- [ ] metadata + `diffstat` + `diff` (paginated) → `mapBitbucketPullRequest`.
- [ ] Stub `fetch`; assert `Bearer` header, workspace-qualified URL, `GitProviderError` on 401/404.

### 3.6 Exports + tests (45 min)

- [ ] `src/index.ts` + README module table gains Bitbucket.
- [ ] Full test pass; grep check for `@harness/domain`-only imports.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/git-provider/src/bitbucket-provider.ts` | `BitbucketProvider` (paginated diff fetch) |
| `packages/git-provider/src/bitbucket-mapper.ts` | `mapBitbucketPullRequest` + `type` tag mapping |
| `packages/git-provider/src/bitbucket-pagination.ts` | `walkPaginated` cursor walker |
| `packages/git-provider/src/__tests__/bitbucket-*.test.ts` | Mapper + provider + pagination tests |
| `packages/git-provider/README.md` (updated) | Modules + "Bitbucket complete" status |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/git-provider test` — green with fixtures only.
- [ ] `mapBitbucketPullRequest` returns the same `PullRequest` shape as GitHub/GitLab.
- [ ] Five `type` tags map to the correct change kinds; renamed files carry both paths.
- [ ] Pagination walks a 2-page fixture to a single flat file list.
- [ ] 401/404 → `GitProviderError` with correct status.
- [ ] `grep -r "from '@harness" packages/git-provider/src` shows only `@harness/domain`.

---

## 6. Notes & Pitfalls

- **Bitbucket `id` vs `display_id`.** The user pastes the `id` from the URL (the workspace-scoped pull request id), not the internal `display_id`. Map on the URL id.
- **`diffstat` is a summary, not the diff.** File *content* comes from the `diff` endpoint; `diffstat` only tells you which files exist and their line counts. Don't try to reconstruct per-file patches from diffstat.
- **Renames are two file types in disguise.** Bitbucket may emit `renamed_file` with an `old` path and a `new` path — keep both, like GitLab's `new_path`/`old_path`.
- **Tomorrow (Day 03):** the registry + `provider_configs` resolution wires all three providers behind one `resolveProvider(url)`.

---

*Next: [Day 03 — Provider Registry + `provider_configs` (Redacted) Resolution](day-03.md)*