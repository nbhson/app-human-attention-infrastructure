# Day 35 — Week 7 Checkpoint: Closed Loop Demonstrable Autonomously

| | |
|---|---|
| **Week** | 7 — Close the loop, deploy observed |
| **Spec refs** | Spec 11 §5.3 (closed learning loop), Architecture §24.3 |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 34 (durable queue behind `IEventBus`) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. No new features. By end of day you will have:

1. A **living demo**: Evaluate → Calibrate → Deploy → Observe running **autonomously** (scheduler-driven) across multiple loop turns, with the loop visibly *learning from* and *responding to* usefulness feedback.
2. **Proof the loop is safe**: a simulated regression rolls back; a simulated lift becomes default *only* via the A/B/human gate; no update self-authors authority.
3. A **traceability walkthrough**: pick any applied calibration update and show its full evidence chain backward (verdicts → runs → corpus → gold labels).
4. A **Week 7 retrospective note**.

**Do not proceed to Day 36 until every acceptance criterion in §5 is green** — Week 8 hardens *this* loop, so it must be demonstrably correct and safe first.

---

## 2. What Week 7 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| Learning pipeline (evaluation → calibration update, gated) | `@harness/learning` | ✅ Day 31 |
| Feedback into context ranking (learn weights from usefulness) | `@harness/learning` | ✅ Day 32 |
| Closed-loop wiring (Evaluate→Calibrate→Deploy→Observe) | `@harness/learning` | ✅ Day 33 |
| Durable queue (Redis/SQS) behind `IEventBus` (optional) | `@harness/event-bus` | ✅ Day 34 |

---

## 3. Tasks

### 3.1 Autonomous multi-turn demo (150 min)

- [ ] `scripts/demo-closed-loop.ts` — seed a usefulness drift, then let the scheduler run ≥3 loop turns; narrate each stage transition as it fires.
- [ ] Include one **regression injection** and one **lift injection** so the demo shows both rollback (regression) and gated defaulting (lift).

### 3.2 Traceability walkthrough (90 min)

- [ ] For one applied update, walk: update → `evidence` (verdicts) → `bench_runs` → `BenchTask` → gold-label evidence (human decision). Print the chain.
- [ ] Confirm every link is persisted and queryable (no "that was in a log line we lost").

### 3.3 Safety proofs (90 min)

- [ ] Regression → `loop.regression` + `calibration.update_rolled_back` (restore `before`).
- [ ] Lift → default only through shadow→A/B→human-approve (`rank.cutover_applied` / human sign-off), never instant.
- [ ] A `notable_change` update cannot self-apply (assert blocked pending human).
- [ ] `AUTO_APPROVABLE` + APPROVE/REJECT untouched by any loop turn.

### 3.4 Week 7 retro (60 min)

File: `docs/retros/week-07-phase3.md` (`# Week 7 Phase 3 Retro — Close the loop`), standard sections.

Prompts: Did the loop ever propose a change we'd reverse on reflection? Is the A/B gate too permissive for ranking? Was the regression rollback actually exercised, or only asserted? Any stage where provenance got thin?

### 3.5 Update wiring map + README (30 min)

- [ ] `docs/architecture/wiring-map.md` — learning pipeline, loop stages, transport modes.
- [ ] `README.md` — "Phase 3 Week 7 Status" note.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo-closed-loop.ts` | Autonomous closed-loop demo |
| `apps/api/src/__tests__/week7-safety.test.ts` | Regression/lift/gate safety proofs |
| `docs/retros/week-07-phase3.md` | Retrospective |
| `README.md` (updated) | Week 7 status |

---

## 5. Acceptance Criteria

- [ ] Closed loop runs autonomously across ≥3 turns, every stage transition visible + persisted.
- [ ] A simulated regression triggers `loop.regression` + rollback (restore `before`).
- [ ] A simulated lift reaches default only via shadow→A/B→human-approve, never instantly.
- [ ] `notable_change` updates are blocked pending human sign-off.
- [ ] `AUTO_APPROVABLE` + APPROVE/REJECT are untouched by any loop turn.
- [ ] One applied update is traceable end-to-end (update → verdicts → runs → task → gold label).
- [ ] `docs/retros/week-07-phase3.md` exists.
- [ ] `pnpm lint` clean across all touched packages.

**Checkpoint rule:** If any of the safety proofs is red — especially "a `notable_change` self-applied" — stop. A loop that can self-author a notable change is the one failure this phase exists to prevent.

---

## 6. Notes & Pitfalls

- **"Autonomous" is a compression of what's safer with autonomy — not an excuse for no gates.** The demo must show the loop *asking for approval* on notable changes, not racing ahead. Autonomy in parameter calibration is fine; autonomy in authorizing notable change is not.
- **Traceability is the checkpoint's yield.** The whole point of Phase 3 evidence discipline is that "the loop improved X" is *provable*, not asserted. If the demo can't print the evidence chain, the loop's outputs are unbacked.
- **Exercise rollback, don't just implement it.** A rollback path that is never run is a rollback path that rots. The regression injection is the proof.
- **Don't drift into tuning the task gate.** If any loop turn touches decision-making (APPROVE/REJECT/AUTO_APPROVABLE), that's a boundary break, not a "nice autonomous feature." The loop calibrates parameters only.
- **Do not harden yet.** Week 8's hardening (Day 36) builds on a *correct* loop. Fix safety/race issues now, then harden under load.
- **Tomorrow (Day 36):** hardening — multi-agent runaway guards, memory growth, hybrid latency.

---

*Prev: [Day 34 — Durable Queue (Redis/SQS) Behind `IEventBus` — Contract Unchanged, Optional](day-34.md) | Next: [Day 36 — Hardening: Multi-Agent Runaway Guards, Memory Growth, Hybrid Latency](day-36.md)*
