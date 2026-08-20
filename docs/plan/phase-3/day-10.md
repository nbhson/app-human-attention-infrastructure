# Day 10 — Week 2 Checkpoint: Consolidation/Decay Validated Against the Decision Log

| | |
|---|---|
| **Week** | 2 — Memory lifecycle + trajectory |
| **Spec refs** | Spec 9 §4.5 (consolidation/decay/archive), Spec 3 §6.1 (Fork/Resume) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 09 (Trajectory Resume + crash recovery) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. No new features. By end of day you will have:

1. A passing **lifecycle validation** that runs consolidation + decay against a *real decision-log-derived* corpus (not synthetic fixtures) and asserts the expected merge/decay outcomes.
2. A **Trajectory Fork + Resume demo** proving both operations end-to-end (head-to-head compare + crash recovery).
3. A **Week 2 retrospective note** capturing what is solid and what is fragile before Week 3 (dependency-graph targeted verification).
4. Confidence that the W2 milestone — "Consolidation/decay/archive validated; trajectory Fork and Resume demonstrable" — is met.

**Do not proceed to Day 11 until every acceptance criterion in §5 is green.**

---

## 2. What Week 2 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| Consolidation: dedup (0.85) + conflict + decay (0.99^days) | `@harness/memory` | ✅ Day 06 |
| Archive (90d) + expiration + hot/cold tier | `@harness/memory` | ✅ Day 07 |
| Trajectory Fork (head-to-head compare) | `@harness/agent-runtime` | ✅ Day 08 |
| Trajectory Resume + Replay + reconciler | `@harness/agent-runtime` | ✅ Day 09 |

---

## 3. Tasks

### 3.1 Decision-log validation corpus (90 min)

- [ ] Extract a validation set from the real `review.decision_submitted` / `memory_entries` already populated in earlier fixtures: 5–10 near-duplicate decision pairs, 2 known contradiction pairs, and 3 entries with known `last_retrieved_at` ages spanning the 90-day archive and decay thresholds.
- [ ] Write `apps/api/src/__tests__/week2-memory-smoke.test.ts` that runs `ConsolidationJob` + `RetentionJob` over this corpus and asserts:
  - Near-duplicates merged (count drops by the expected delta).
  - Contradiction keeps the higher-confidence entry; loser superseded.
  - Decayed entries (`0.99^days < floor`) excluded from retrieval.
  - Archived (90d unused) entries moved to `tier='cold'`.

### 3.2 Fork + Resume demo script (120 min)

- [ ] A `scripts/demo-week2.ts` (or a documented debug endpoint sequence) that:
  1. Seeds a 4-step run, forks at step 2 with a different model (MockLLM), prints the comparison report.
  2. Starts a run, "kills" after 2 steps, runs `RunReconciler`, shows recompleted run with contiguous steps.
- [ ] Assert the demo is deterministic and rerun under a clean `harness_test` schema.

### 3.3 Fix outstanding lint/type/boundary issues (as needed, 60 min)

- [ ] `pnpm lint` — zero errors/warnings.
- [ ] `pnpm -r typecheck` — zero errors.
- [ ] Verify `packages/memory` and `packages/agent-runtime` still respect the engine boundary.

### 3.4 Week 2 retro (45 min)

File: `docs/retros/week-02-phase3.md` (`# Week 2 Phase 3 Retro — Memory lifecycle + trajectory`), standard sections.

Prompts: Did decay # dedup fire in the wrong order anywhere? Did fork replay stay deterministic with real tools? Is the reconciler's heartbeat window sane? Does the decision-log-derived corpus behave like the synthetic fixtures did?

### 3.5 Update wiring map + README (30 min)

- [ ] `docs/architecture/wiring-map.md` — list `ConsolidationJob`, `RetentionJob`, `TrajectoryForkService`, `TrajectoryResumeService`, `RunReconciler`.
- [ ] `README.md` (root) — "Phase 3 Week 2 Status" note.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/__tests__/week2-memory-smoke.test.ts` | Lifecycle validation against decision-log corpus |
| `scripts/demo-week2.ts` | Fork + Resume demo |
| `docs/retros/week-02-phase3.md` | Retrospective |
| `README.md` (updated) | Week 2 status section |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/memory test` and `pnpm --filter @harness/agent-runtime test` — all pass.
- [ ] Consolidation/decay/archive validated against *decision-log-derived* entries (not only synthetic fixtures).
- [ ] Fork demo shows a head-to-head comparison with a non-null `forkedFrom`.
- [ ] Resume demo recovers an interrupted run without re-executing committed steps.
- [ ] `pnpm lint` — zero errors; `pnpm -r typecheck` — zero errors.
- [ ] No `UPDATE`/`DELETE` on immutable Memory columns (search `packages/memory`).
- [ ] `docs/retros/week-02-phase3.md` exists and names real fragility.

**Checkpoint rule:** If any criterion is red, stop. Fix it today. Week 3 (code index + dependency graph) rests on a clean trajectory + memory foundation.

---

## 6. Notes & Pitfalls

- **Real decision logs behave differently from fixtures.** Synthetic fixtures have clean similarities; real decisions carry near-paraphrase noise. If dedup under-merges on the real corpus, note it in the retro — do **not** silently lower the 0.85 threshold today (that's a benchmark/calibration decision).
- **Fork/replay determinism is the risk to watch.** If a real tool (not MockLLM) leaks time/rand into a step output, replay drifts. If you see drift, fix the step serialization (capture `tool_output` verbatim), not the comparison.
- **The reconciler must not fork.** A recovered run continues as itself, not as a fork. Confirm the demo shows one `runId` with contiguous steps, not a parent+child pair.
- **Do not start the tree-sitter index today.** Week 3 is a hard dependency boundary: the code index is a new package with its own schema. A clean checkpoint now saves archaeology later.
- **Tomorrow (Day 11):** tree-sitter symbol index — functions/classes/imports for the target repo.

---

*Prev: [Day 9 — Trajectory Resume: Crash Recovery + Mid-run Replay](day-09.md) | Next: [Day 11 — tree-sitter Symbol Index: Functions/Classes/Imports](day-11.md)*
