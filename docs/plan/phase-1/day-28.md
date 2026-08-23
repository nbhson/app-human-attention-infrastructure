# Day 28 — Documentation: specs → v0.2, dev guide, runbook

| | |
|---|---|
| **Week** | W4 — Human loop + E2E |
| **Spec refs** | Spec 1 (index → package READMEs), Spec 9/11 (deferral notes) |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 01–27 (as-built system to document) |

---

## 1. Objectives

- Reconcile the specs/docs to **as-built reality**: the architecture doc and per-subsystem references reflect the review-first control plane, not the retired code-gen path.
- Write the **dev guide** (clone-to-green: `docker compose up && pnpm dev`) and the **operators runbook** (audit queries, redaction, failure semantics).
- Explicitly document known gaps as a **Phase 2 backlog** (Evaluation Engine, attention calibration, semantic ranking) and what stays deferred to Phase 3 (GitLab/Bitbucket, write-back).
- Preserve Spec 9 (append-only evidence) and mark Spec 11 (Evaluation Engine) as a seam-only in Phase 1.

## 2. Design Decisions

- Docs follow the "index + package README" model: the architecture doc is the index; detail lives in each `packages/*/README.md` (the day files reference spec § where a package readme now owns the detail).
- The retired code-generation surface (dispatcher, workflow runner, `AgentRunner`/ReAct loop, `MergeService`/`ReworkService`, startup reconciler, tool execution, `applyAndCommit`) is documented **only** as removed — never as a foreground activity.

## 3. Tasks

### 3.1 Spec reconciliation (180 min)
- [ ] Update `docs/core` architecture overview to v0.2 review-first framing
- [ ] Confirm subsystem → package map matches the built tree

### 3.2 Dev guide + runbook (150 min)
- [ ] `docs/dev-guide.md` clone-to-green walkthrough
- [ ] `docs/runbook/*` audit cookbook + failure/redaction runbook

### 3.3 Backlog + deferral notes (90 min)
- [ ] Phase 2 backlog (Evaluation, calibration, semantic ranking) + Phase 3 deferrals (GitLab/Bitbucket, write-back, embeddings)

## 4. Deliverables

| File | Description |
|------|-------------|
| `docs/core/*_v0.2.md` | Reconciled architecture spec |
| `docs/dev-guide.md` | Clone-to-green guide |
| `docs/runbook/README.md` | Operators runbook |
| `docs/plan/phase-2/README.md` | Phase 2 backlog (pointer) |

## 5. Acceptance Criteria

- [ ] `docs/dev-guide.md` correctly describes `docker compose up && pnpm dev` on a clean checkout
- [ ] The architecture doc names the retired code-gen path as removed, and the review loop as the foreground
- [ ] Phase 2 backlog + Phase 3 deferral notes are written and consistent with the plan

## 6. Notes & Pitfalls

- Docs are part of the deliverable, not a follow-up — a demonstrable system with stale specs fails the Day-30 "specs → v0.2" criterion.

---

*Next: [Day 29 — Final demo + retrospective](day-29.md)*