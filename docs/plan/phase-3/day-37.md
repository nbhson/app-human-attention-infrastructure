# Day 37 — E2E Full System Under Phase-3 Infrastructure + Load Profile

| | |
|---|---|
| **Week** | 8 — Harden, document, exit |
| **Spec refs** | Spec 1 (system architecture), Spec 11 §5 (evaluation on full system), Architecture §24.3 |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 36 (hardening) |

---

## 1. Objectives

By end of day you will have:

1. A **full-system E2E** that exercises every Phase-3 subsystem together under a realistic **load profile** (concurrent tasks, mixed labels, closed loop running), not a happy-path script.
2. **End-to-end correctness under load**: the human gate, `AUTO_APPROVABLE` sampling path, multi-agent roles, verification, memory, hybrid ranking, and the learning loop all behave correctly under concurrency.
3. **Load metrics**: throughput, p95 latency, error rate, queue depth, memory-store size, judge throughput — captured to a report.
4. **A defect list** (any latent bugs found under load) with the ones fixed today vs. the ones deferred — with reasons.

This is the phase's integration proof: all the pieces that were correct in isolation are shown correct *together* under stress.

---

## 2. Design Decisions

### 2.1 Load profile reflects real traffic

Generate a mixed workload matching Day 26's stratum mix:
- concurrent `HUMAN_ROUTED` tasks (the dominant class),
- a sampling slice of `AUTO_APPROVABLE` tasks (exercising the auto-path without enabling it broadly),
- `REWORK` + `DEFECT_CAUGHT_LATER` patterns to stress verification + attention recall,
- the learning loop and judge running in the background (scheduler), as in production.

The profile is **representative**, not a synthetic worst-case that never occurs.

### 2.2 Deterministic E2E harness with injectable real dependencies

- Real Postgres, real retrieval path (seeded corpus), real `IEventBus` (in-process default; optional Redis mode smoke-tested), Mock/Real LLM behind `LLMProvider` (config).
- A single `scripts/e2e-load.ts` drives the workload and collects metrics; a fixed random seed keeps runs comparable.

### 2.3 Correctness-under-load assertions

The E2E isn't just "it didn't crash." Assert invariants hold under concurrency:
- `review.decision_submitted` always `triggered_by: 'human'`; `AUTO_APPROVABLE` only via sampling audit.
- No role-tool violation, even under fan-out.
- Memory store size bounded over the run; no duplicate side effects from at-least-once delivery.
- No `goldPatch` leak in judge prompts; no `HUMAN_ROUTED` auto-advance.

### 2.4 Metrics + report

Collect throughput (tasks/min), p95 latency (retrieval, verification, review round-trip), error rate, `IEventBus` queue depth (Redis mode), judge verdicts/sec, memory store size. Emit `docs/reports/phase3-e2e.md`.

### 2.5 Defect triage, not defect hoarding

Bugs found today get fixed (if load-related and in scope) or logged with an owner and severity. The goal is a *complete* integration picture, not a perfect run — unrecorded failures are the failure.

---

## 3. Tasks

### 3.1 Load harness + fixtures (180 min)

- [ ] `scripts/e2e-load.ts` + mixed-workload generator (seeded, stratum-mixed).
- [ ] Bootstrap full Phase-3 infra (DB, retrieval, bus, judge, scheduler) via DI (TOKENS).

### 3.2 E2E under load (180 min)

- [ ] Run the mixed workload; assert the correctness-under-load invariants (§2.3) in-flight.

### 3.3 Metrics collection + report (90 min)

- [ ] Capture load metrics; write `docs/reports/phase3-e2e.md`.

### 3.4 Defect fixes + triage (90 min)

- [ ] Fix load-related defects in scope; log deferred with owner/severity.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/e2e-load.ts` | Full-system load harness |
| `apps/api/src/__tests__/e2e-load.test.ts` | Correctness-under-load assertions |
| `docs/reports/phase3-e2e.md` | Load metrics + defect list |

---

## 5. Acceptance Criteria

- [ ] Full Phase-3 system runs a mixed-workload E2E without crashes; metrics captured.
- [ ] Under load: `review.decision_submitted` always `triggered_by: 'human'`; `AUTO_APPROVABLE` only via sampling path.
- [ ] No role-tool violation, no `goldPatch` leak, no `HUMAN_ROUTED` auto-advance under concurrency.
- [ ] Memory store stays bounded over the run; no duplicate side effects from at-least-once delivery.
- [ ] p95 latency + throughput + error rate recorded; Redis transport mode smoke-tested.
- [ ] Defects fixed-or-triaged (none silently ignored); `phase3-e2e.md` lists them.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **"It didn't crash" is not an E2E pass.** The pass condition is the invariants holding *under concurrency* — a load run that quietly drops `triggered_by: 'human'` or auto-treats a `HUMAN_ROUTED` task is a red result, not a footnote.
- **Load profile must mirror traffic.** An all-`AUTO_APPROVABLE` or all-trivial workload proves nothing about the pre-review queue that matters. Use the stratum mix.
- **Concurrency is where invariants break.** Single-task paths are already proven; load exposes double-processing, racey gates, and budget inheritance bugs. That's the point.
- **Record failures honestly.** A perfect-looking report with hidden dropped defects will mislead the exit review (Day 40). Triage explicitly.
- **The closed loop runs *during* the load, not after.** Evaluate→Calibrate→Deploy→Observe should be live against the workload; stopping it to "keep the run clean" measures a system that doesn't exist in production.
- **Tomorrow (Day 38):** docs — specs to v1.0 candidates, runbook + dev guide.

---

*Prev: [Day 36 — Hardening: Multi-Agent Runaway Guards, Memory Growth, Hybrid Latency](day-36.md) | Next: [Day 38 — Docs: Specs to v1.0 Candidates, Runbook + Dev Guide](day-38.md)*
