# Day 05 — Week 1 Checkpoint: Fetch PR/MR from All Three Providers + Jira

| | |
|---|---|
| **Week** | 1 — Provider breadth |
| **Spec refs** | git-provider §2, ticket-provider §2; Phase-3 README §5 (W1 milestone) |
| **Estimated effort** | 5h |
| **Prerequisites** | Days 01–04 (three `GitProvider` impls, registry, `provider_configs`, hardened `JiraProvider`) |

---

## 1. Objectives

By end of day you will have:

1. A demonstrable end-to-end ingest: paste a **GitHub PR**, **GitLab MR**, or **Bitbucket PR** URL + a **Jira key** → the diff + requirement fetch through the registry, each host backed by a `provider_configs` row.
2. A scripted demo (`scripts/demo-provider-breadth.ts`) exercising all three hosts + Jira against fixture-gated HTTP stubs (no live credentials required in CI).
3. Integration debt from Days 01–04 closed: registry errors, token redaction, and seam-shape parity verified together, not in isolation.
4. Week-1 milestone green: "GitLab + Bitbucket `GitProvider` impls; hardened JiraProvider; fetch PR/MR from all three + Jira issue."

The checkpoint is a *slice-wide* proof, not new features — stop feature work, make the breadth demonstrable.

---

## 2. Design Decisions

### 2.1 Demo runs stubbed, live-optional

CI can't hold real tokens for three hosts + Jira. The demo script runs against a **stub HTTP layer** returning the exact fixtures Days 01–04 produced; a `--live` flag switches to real endpoints when a developer exports the env tokens. This keeps "demonstrable" true every day, not just on a developer's laptop.

### 2.2 One ingest facade for review input

Expose a thin `resolveReviewInput({ prUrl, jiraKey })` over the registry + ticket provider so the reviews route has a single call site that chooses providers by host. No engine imports the provider packages directly — the facade lives in `apps/api`.

### 2.3 The seam parity contract

All three `GitProvider` outputs must produce a `PullRequest` whose `files[]` are **structurally identical** (same `changeKind` enum). The checkpoint's sanity test diffs the three mapped fixtures against the shared `PullRequest` shape — the unit tests checked shapes individually; today checks them *together*.

---

## 3. Tasks

### 3.1 Demo script (75 min)

- [ ] `scripts/demo-provider-breadth.ts` — for each host URL, resolve provider → fetch → print `title`, `fileCount`, first file change kind; then `fetchIssue(jiraKey)`.
- [ ] Stub HTTP by default; `--live` flag for real endpoints.

### 3.2 Ingest facade (45 min)

- [ ] `resolveReviewInput` in `apps/api` — resolves git + ticket providers, returns unified `{ pullRequest, issue }`.

### 3.3 Seam-parity sanity test (45 min)

- [ ] Fixture-shape test: the three mapped `PullRequest`s pass one shared `assertPullRequestShape` validator.

### 3.4 Integration debt pass (60 min)

- [ ] Registry error wrapping reviewed across all hosts; disabled-config path tested.
- [ ] Token redaction verified on the config list endpoint used by the demo.

### 3.5 Run the checkpoint (45 min)

- [ ] `pnpm demo:provider-breadth` (stubbed) completes against all three hosts + Jira.
- [ ] Record the demo output in `docs/retros/` (one paragraph) as the W1 evidence.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo-provider-breadth.ts` | Demo: all three hosts + Jira |
| `apps/api/src/review-input-facade.ts` | `resolveReviewInput` facade |
| `apps/api/src/__tests__/seam-parity.test.ts` | Shared `PullRequest` shape check |
| `docs/retros/phase3-w1.md` | Week 1 checkpoint evidence |

---

## 5. Acceptance Criteria

- [ ] `pnpm demo:provider-breadth` runs stubbed end-to-end and prints a fetched PR/MR for each of GitHub, GitLab, Bitbucket + a Jira issue.
- [ ] `resolveReviewInput` resolves by host without hard-coded provider classes.
- [ ] The seam-parity validator passes for all three mapped fixtures.
- [ ] No live token is required for the demo; no key is committed.
- [ ] `pnpm test && pnpm lint` green across `git-provider`, `ticket-provider`, `db`, `api`.

---

## 6. Notes & Pitfalls

- **Checkpoint ≠ new feature.** Resist the urge to add write-back or verification today; write a clean demo and close the integration debt instead. Days 06–10 own write-back.
- **The stub must be representative, not trivial.** If the stub returns fake shapes that wouldn't survive the real mapper, the demo proves nothing — reuse the Days 01–04 fixtures verbatim.
- **Parity failures are usually an enum mismatch.** GitLab "removed" vs Bitbucket "deleted_file" vs GitHub "removed" — the shared `changeKind` test is the net that catches a third flavor slipping through.
- **Next week (Day 06):** `WriteBackService` — commentary/status write-back behind a per-provider toggle.

---

*Next: [Day 06 — `WriteBackService` Interface + GitHub Comment/Status Impl](day-06.md)*