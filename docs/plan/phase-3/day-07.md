# Day 07 — Write-back for GitLab/Bitbucket + Jira Transition

| | |
|---|---|
| **Week** | 2 — Write-back |
| **Spec refs** | git-provider §2, ticket-provider §2 (comment/transition primitives); Phase-3 README §3 |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 06 (`WriteBackService` seam + `GitHubWriteBack`); `JiraProvider` comment/transition (Day 04) |

---

## 1. Objectives

By end of day you will have:

1. `GitLabWriteBack` and `BitbucketWriteBack` adapters — mapping the same `WriteBackIntent` actions to each host's REST comment/status endpoints.
2. `JiraWriteBack` — COMMENT → Jira issue comment, TRANSITION → Jira status transition (the ticket-side write primitives from Day 04), surfaced through the same service.
3. `WriteBackService` now dispatches to **all** providers behind one interface; decisions on any provider produce the same-shaped external write.
4. Fixture-tested adapters; no live credentials.

Completes write-back breadth; Day 08 adds the audit log + idempotency on top.

---

## 2. Design Decisions

### 2.1 Same intent, host-shaped endpoints

`COMMENT`/`STATUS`/`LABEL` stay the vocabulary; each adapter translates:

- **GitLab** — comment: `POST /projects/:id/merge_requests/:iid/notes`; status: `POST /projects/:id/statuses/:sha` (or `/commit/:sha/statuses`); "label" → GitLab MR labels via `PUT /merge_requests/:iid` label_ids (or note-fallback if labels are out of scope — decide: comment-only for v0, leave a thin `LABEL` → addLabel via labels API).
- **Bitbucket** — comment: `POST /2.0/repositories/{ws}/{repo}/pullrequests/{id}/comments`; status: `POST .../commit/{sha}/statuses/build` (key + url + state).
- **Jira** — COMMENT → `plainTextToAdf` + `postComment`; TRANSITION → `transition(toState)` (name-resolved, from Day 04).

### 2.2 Jira action differs — add TRANSITION to the intent vocabulary

The intent set approved in Day 06 was generic. Jira's status write is a *transition*, not a PR status; extend `WriteBackAction` with `'TRANSITION'` and a `toState` field (optional, required only for TRANSITION). Git adapters reject TRANSITION with a clear error; Jira rejects STATUS/LABEL.

### 2.3 Adapter errors normalize to `WriteBackError`

Each adapter wraps host errors into a shared `WriteBackError { provider, action, externalId, status? }` so the service logs one shape regardless of host.

---

## 3. Tasks

### 3.1 Intent vocabulary extension (30 min)

- [ ] Add `TRANSITION` to `WriteBackAction`; add optional `toState` to `WriteBackIntent`.
- [ ] Update Day 06 tests that enumerated actions (now 4).

### 3.2 `GitLabWriteBack` (90 min)

- [ ] Comment, status, label mapping + tests (stubbed fetch).

### 3.3 `BitbucketWriteBack` (90 min)

- [ ] Comment, build-status mapping + tests.

### 3.4 `JiraWriteBack` (75 min)

- [ ] COMMENT via ADF builder; TRANSITION via name-resolved transition; rejects STATUS/LABEL.
- [ ] Tests incl. `toState` no-match error propagation.

### 3.5 Service dispatch update (45 min)

- [ ] Wire GitLab/Bitbucket/Jira adapters into `write()` dispatch.
- [ ] Normalize host errors → `WriteBackError`.

### 3.6 Boundary + full pass (30 min)

- [ ] Grep: `@harness/writeback` imports only domain + git-provider + ticket-provider.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/domain/src/writeback.ts` (updated) | `TRANSITION` action + `toState` |
| `packages/writeback/src/gitlab-writeback.ts` | GitLab comment/status/label adapter |
| `packages/writeback/src/bitbucket-writeback.ts` | Bitbucket comment/status adapter |
| `packages/writeback/src/jira-writeback.ts` | Jira comment/transition adapter |
| `packages/writeback/src/writeback-service.ts` (updated) | Full provider dispatch |
| `packages/writeback/src/__tests__/*.test.ts` | Adapter tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/writeback test` — green; all four providers dispatched.
- [ ] COMMENT intent writes a comment on all three Git hosts + Jira (fixtures).
- [ ] TRANSITION intent transitions a Jira issue by status name; STATUS intent sets a commit status on GitHub/GitLab/Bitbucket.
- [ ] Git adapters reject TRANSITION, Jira rejects STATUS/LABEL — with `WriteBackError`.
- [ ] Boundary grep clean; `pnpm lint` clean.

---

## 6. Notes & Pitfalls

- **Bitbucket status needs a `key`** (a stable app key) — pick one constant per provider config, don't generate per call or idempotency keys change identity.
- **GitLab status targets a SHA, not a PR.** Requires the MR's `sha` (head commit) — the adapter must look it up or accept it in the intent; prefer accepting it in the intent from the fetched PR.
- **Jira transition is stateful and human-visible.** The `toState` must be a name the human chose; the adapter's "no such status" error (Day 04) is surfaced, not swallowed.
- **Day 08** layers `writeback_log` + idempotency so a retry can't double-comment.

---

*Next: [Day 08 — `writeback_log` Audit + Idempotency (No Duplicate Comments)](day-08.md)*