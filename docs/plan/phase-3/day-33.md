# Day 33 — Closed Loop Wiring: Evaluate → Calibrate → Deploy → Observe

| | |
|---|---|
| **Week** | 7 — Close the loop |
| **Spec refs** | Architecture §24.3 (Learning step); Spec 11 (evaluation→deploy); Phase-3 README §1 (goal 7) |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 31–32 (calibration job, usefulness feedback), judge signals, A/B harness |

---

## 1. Objectives

By end of day you will have:

1. The full closed loop wired as **one observable cycle**: Evaluate (metrics + judge + usefulness) → Calibrate (refit) → Deploy (gated promotion) → Observe (post-deploy metrics) → back to Evaluate.
2. The cycle is **tracked and auditable** — each stage writes a status/event, with a correlation id tying a decision's data to the candidate it produced and the deployment it became.
3. Observe closes back: post-deploy metrics feed the *next* evaluation window, so the loop re-enters without a manual kick.
4. A `learning.loop.completed` event + an ops view showing the last N cycles.

This is the day the pictures in the phase README ("Learning step closes the loop automatically") become a runnable subsystem.

---

## 2. Design Decisions

### 2.1 The four stages are a state machine, not a script

`Evaluate → Calibrate → Deploy → Observe` each own an event + status, and the cycle only advances on the prior stage's success. A guardrail HOLD parks at Deploy (candidate logged, not promoted) and the loop still returns to Evaluate with the HOLD recorded.

### 2.2 One correlation id per cycle

`learningCycleId` joins: evaluation window rows → fit candidate → A/B outcome → deploy decision → post-deploy observation. Full traceability end-to-end.

### 2.3 Observe feeds the next Evaluate

Post-deploy metrics (after a PROMOTE) become the *inputs* to the next evaluation window — so the loop is genuinely closed, not a cron with four independent steps.

### 2.4 Human gate untouched (again)

The cycle tunes calibration/routing only; APPROVE/REJECT and the sampled `AUTO_APPROVABLE` path are not part of this state machine.

---

## 3. Tasks

### 3.1 Cycle orchestration (90 min)

- [ ] `LearningLoop` state machine (Evaluate → Calibrate → Deploy → Observe) + `learning.loop.completed`.

### 3.2 Correlation + audit (60 min)

- [ ] `learningCycleId` propagation across stages; per-stage events.

### 3.3 Observe → Evaluate re-entry (60 min)

- [ ] Post-deploy metrics write into the next evaluation window input.

### 3.4 Ops view (45 min)

- [ ] `GET /api/learning/cycles` — last N cycles with status + outcomes.

### 3.5 Tests (75 min)

- [ ] Full cycle advances stage-by-stage; HOLD parks at Deploy; correlation id joins all stages; Observe re-enters Evaluate.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/attention-engine/src/learning/learning-loop.ts` | Cycle state machine |
| `packages/attention-engine/src/learning/cycle-audit.ts` | Correlation + per-stage events |
| `apps/api/src/routes/learning.ts` | Cycle status endpoint |
| `packages/attention-engine/src/__tests__/closed-loop.test.ts` | Closed-loop tests |

---

## 5. Acceptance Criteria

- [ ] Evaluate → Calibrate → Deploy → Observe run as one tracked cycle.
- [ ] A single `learningCycleId` joins evaluation → candidate → A/B → deploy → observation.
- [ ] Guardrail HOLD parks at Deploy and still returns to Evaluate.
- [ ] Observe output re-enters the next Evaluate window.
- [ ] Human APPROVE/REJECT gate untouched.

---

## 6. Notes & Pitfalls

- **HOLD is not a dead end.** The loop must complete a cycle even on HOLD (log + re-enter Evaluate) or the automation stalls the first time the guardrail holds.
- **Correlation id is the audit backbone.** Without one id spanning the cycle, "why are these weights live" degenerates into folklore.
- **Observe must actually feed forward.** A loop that exports metrics to a dashboard but not into the next window is observation theater, not a closed loop.
- **Day 34:** durable queue (Redis/SQS) behind `IEventBus` (optional).

---

*Next: [Day 34 — Durable Queue (Redis/SQS) behind `IEventBus` (Optional)](day-34.md)*