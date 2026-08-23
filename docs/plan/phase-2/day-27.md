# Day 27 — End-to-End Run Under Phase-2 Infrastructure

| | |
|---|---|
| **Week** | 6 — Harden + exit review |
| **Spec refs** | Spec 1 §24.4 (production readiness / E2E), Spec 10 (observability), Spec 2 §7 (saga/circuit-breaker), Spec 11 §4 (pipeline quality) |
| **Estimated effort** | 8h |
| **Prerequisites** | Days 21–26 (subsystems + hardening); Phase-1 E2E fixture (task → review → context → verification → decision) |

---

## 1. Objectives

By end of day you will have:

1. A **full end-to-end run** of one representative task through the *entire Phase-2 pipeline* — auth (actor identity on every write), sandboxed verification, object-store backing (including the pinned review report), cache, metrics — proving the hardened subsystems compose into *one system*, not five subsystems wired side-by-side.
2. **Telemetry integrity across the run** — the E2E trace maps `trace_id ↔ correlation_id` (Day 3), every decision carries `actor_id` (Days 1–2), and every verification result carries `content_hash` (Day 22), so the run is a *reconstructible* record from start to finish.
3. **Six seams exercised in one run** (`IEventBus`, `Retriever`, `Ranker`, `Embedder`, `ContentStore`, `LLMProvider`) to confirm the modular-monolith seams all route through DI and none bypass to a monolith direct call.
4. A **E2E runbook + fixture** committed so Phase 3 can run it as a nightly canary against any change.

Day 27 is the system-level "it actually works" proof — the unit tests have been green for weeks; this is the first time the whole review loop is observed end to end under the new infra.

---

## 2. Design Decisions

### 2.1 One canonical fixture, executed for real per environment

`scripts/demo/week6-e2e.md` runs a real task (a small, safe, representative code change) through the real pipeline — not a mocked walk. The fixture is committed so every environment (dev, a Phase 3 CI canary) runs the *same* task and the results are comparable.

### 2.2 E2E = observability assertion, not just success assertion

Passing means *two* things, both asserted:

1. **Functional**: task → context (`rank_method = 'keyword'`, shadow comparison recorded) → review (report + findings, read-only) → review report pinned via `ContentStore` (large diff routed to object store) → verification (sandbox, `content_hash`) → decision (`actor_id`, `review.decision_submitted`) → `task.completed`.
2. **Observable**: the run's `trace_correlation` row links the OTel `trace_id` to the `correlation_id`; the `event_log` replays the run's full decision history; the metrics registry shows the pipeline counters incremented.

If the task completes but the trace can't be reconstructed, the E2E is **red** — a pipeline you can't observe is not a Phase-2 pipeline (Spec 10).

### 2.3 Every write is attributed and every decision is a record

```text
event_log:   [task.created] → [context.snapshot_created] → [review.report_generated] → [artifact.created] → ... → [verification.check_completed(content_hash)] → [review.decision_submitted(actor_id)] → [task.completed]
verification: verification_reports (content_hash, exitCode, sandbox=true)
review:       review_reports (content_hash, backend)   -- the pinned, hash-verified report
auth:         actor_id on review_decisions + event_log rows (Days 1–2)
```

The E2E script asserts these fields are non-null at each step — not just that rows exist. An `actor_id IS NULL` on a decision is a red run.

### 2.4 The seam check is a *grep-based architecture test* in the E2E

The runbook includes the Phase-1 style guards, now extended to the Phase-2 seams:

```bash
grep -rn "from '@harness/verification-engine'" packages/context-engine/src   # must be empty
grep -rn "new ObjectStoreContentStore" packages/artifact-tracker/src          # must be empty (DI only)
grep -rn "new ObjectStoreContentStore" packages/review/src                    # must be empty (DI only)
```

So "end-to-end" also means "end-to-end through the seams, not around them."

---

## 3. Tasks

### 3.1 E2E fixture + runbook (90 min)

- [ ] `scripts/demo/week6-e2e.md` — the canonical task and the assert list (§2.3).
- [ ] A seed script to place the fixture in a fresh environment (both dev and a throwaway docker-compose).

### 3.2 Run the E2E (120 min)

- [ ] Execute the full loop manually once; record the trace, event log, and metrics deltas as the reference run.

### 3.3 Telemetry reconstruction assertions (90 min)

- [ ] `packages/observability/src/e2e/reconstruct.ts` — given a `correlation_id`, pull `trace_correlation` (trace_id), replay `event_log`, and dump the decision history; assert every `review`/`verification` step carries its `actor_id`/`content_hash`.

### 3.4 Seam guard (45 min)

- [ ] Extend the Phase-1 architecture test to the six Phase-2 seams (§2.4); wire into the E2E script.

### 3.5 Fix what the run exposes (up to 2h)

- [ ] Whatever the first real E2E found (a missing null-check, a wire that's off, a counter that doesn't increment) — fix and re-run to green.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo/week6-e2e.md` | Canonical E2E runbook |
| `scripts/seed-e2e-fixture.ts` | Fixture seeder |
| `packages/observability/src/e2e/reconstruct.ts` | Telemetry reconstruction |
| `packages/arch-test/src/seams-e2e.ts` (updated) | Seam guards |
| `docs/retros/e2e-reference.md` | Reference run record (trace/event/metrics) |

---

## 5. Acceptance Criteria

- [ ] The canonical task completes functionally through auth → context → review (read-only report) → object store (report + large diff) → sandboxed verification → decision → `task.completed`.
- [ ] `rank_method === 'keyword'` in the served snapshot, with a `shadow_rank_comparisons` row recorded.
- [ ] `trace_correlation` maps the run's `trace_id ↔ correlation_id`; `reconstruct(correlation_id)` replays the full decision history.
- [ ] Every `review.decision_submitted` has non-null `actor_id`; every `verification_reports` row has `content_hash` + `sandbox=true`; every `review_reports` row has `content_hash`.
- [ ] Metrics registry shows pipeline counters incremented for the run (task, verify, review, cache-hit, sandbox).
- [ ] Seam guard passes: no engine imports another; `ContentStore`/`Sandbox`/`Embedder` resolved via DI only.
- [ ] Runbook committed and reproducible in a throwaway environment (`docker compose up` → run → green).
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green.

---

## 6. Notes & Pitfalls

- **A green pipeline you can't reconstruct is a red E2E.** Phase 2's whole thesis was closing the measurement loop; if the trace doesn't replay, the loop is open by definition. The reconstruction assertion is not optional ceremony.
- **The E2E fixture must be *safe and deterministic* by construction.** It's a real task, but it must not depend on wall-clock, an external LLM non-determinism budget, or a network trip — otherwise "green today, red tomorrow" is noise, not signal. Sandbox `--network none` already helps; add a fixed seed for any stochastic step.
- **The first real E2E run is where the wiring bugs are.** Weeks of unit tests can pass while two subsystems are wired *just wrong enough* (off-by-one token, a counter that reads but doesn't increment on the async path). Budget the "fix what the run exposes" block seriously — it's the point of the day.
- **"End-to-end through the seams" is a grep, but it's the right grep.** A module that bypasses `ContentStore` and talks to S3 directly will pass every functional test and break the modular monolith. The seam guard is cheap insurance for the Phase-2 boundary rules (R7–R12).
- **Reference run is a benchmark, not a snapshot of perfection.** Record it to `docs/retros/e2e-reference.md` so Phase 3 has a baseline; don't optimize the numbers today.
- **Next (Day 28):** docs — bump specs to v0.3 where Phase 2 changed them, and update the dev guide + runbook for the new infra.

---

*Prev: [Day 26 — Hardening](day-26.md) | Next: [Day 28 — Docs: Specs to v0.3 + Runbook](day-28.md)*