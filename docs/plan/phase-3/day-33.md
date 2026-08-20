# Day 33 — Closed-Loop Wiring: Evaluate → Calibrate → Deploy → Observe Runs Continuously

| | |
|---|---|
| **Week** | 7 — Close the loop, deploy observed |
| **Spec refs** | Spec 11 §5.3 (closed learning loop), Architecture §24.3 (Phase 3 closes the loop) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 32 (feedback into context ranking) |

---

## 1. Objectives

By end of day you will have:

1. The four stages — **Evaluate → Calibrate → Deploy → Observe** — wired into a single **continuous, event-driven loop**, not a hand-run script.
2. The loop is **observable**: every stage transition, every prepared/deployed/rolled-back update is an auditable event with provenance (Spec 11 §5.3).
3. **Drift detection**: Observe feeds back whether an applied update actually improved things; a regression triggers rollback, closing the loop *safely*.
4. The loop **never self-authors authority**: deploy remains gated (shadow/A/B → human-approve for notable changes), and the human gate is untouched.

This is the seam that makes Phase 3 "learning," not "automation." It must run continuously while remaining reversible and auditable.

---

## 2. Design Decisions

### 2.1 Loop stage state machine

```typescript
export type LoopStage = 'EVALUATE' | 'CALIBRATE' | 'DEPLOY' | 'OBSERVE';

export interface LoopTransition {
  id: string;
  from: LoopStage;
  to: LoopStage;
  updateId?: string;          // calibration update moving through
  evidence: EvidenceRef[];
  triggeredAt: Date;
  actor: 'pipeline' | 'human';
}
```

The loop is a **stage machine whose transitions are events**, not a hard-coded `while(true)`. Each transition is persisted (`loop_transitions`) and auditable.

### 2.2 Event contract for the loop

- `evaluation.results_available { runId, corpusVersion, verdictCount }` → EVALUATE completes.
- `calibration.update_prepared { updateId, target, before, after, effectSize }` (Day 31) → CALIBRATE completes.
- `calibration.update_deployed { updateId, mode: 'shadow'|'ab'|'default', gate: 'ab_won'|'human_approved' }` → DEPLOY completes.
- `loop.observation_recorded { updateId, metric, before, after, drift }` → OBSERVE completes (and may re-trigger EVALUATE or rollback).

The envelope is the standard one (event_id, correlation_id, etc.) — no new event encoding.

### 2.3 Deploy gating is the loop's conscience

DEPLOY advances only via the existing seams:
- **Shadow → A/B → default** for ranking/retrieval params (Day 19/32).
- **Human approval** for calibration updates whose `before/after` delta exceeds a `notable_change` threshold (config-defined) — the loop may *prepare* anything but may *apply* a notable change only after human sign-off.
- `AUTO_APPROVABLE` and the APPROVE/REJECT gate are **outside** the loop entirely — the loop calibrates parameters, never task decisions.

### 2.4 Drift detection closes the loop safely

OBSERVE compares the post-deploy metric to the `before` baseline over a configurable window. `drift` below a threshold → emit `loop.regression` and trigger **rollback** (restore `before`, emit `calibration.update_rolled_back`). A loop that can't roll back is not a learning loop; it's a one-way valve.

### 2.5 Scheduler + idempotency

A cron/scheduled trigger (and event-triggered re-entry) fires each stage; every stage is **idempotent** (re-running an already-completed stage is a no-op, via `loop_transitions` dedup). This keeps "runs continuously" from becoming "runs concurrently against itself."

---

## 3. Tasks

### 3.1 Loop state machine + schema (90 min)

- [ ] `loop.ts` — `LoopStage`, `LoopTransition`; `loop_transitions` table + migration.

### 3.2 Event wiring (150 min)

- [ ] Emit/consume the five loop events (§2.2) through `IEventBus`; wire stage transitions.

### 3.3 Scheduler + idempotency (120 min)

- [ ] Cron/event trigger for EVALUATE; idempotent stage handlers (dedup via `loop_transitions`).

### 3.4 Deploy gating integration (90 min)

- [ ] Route DEPLOY through shadow/A-B/human-approve seams; `notable_change` → human approval required.
- [ ] Assert loop never touches APPROVE/REJECT/AUTO_APPROVABLE.

### 3.5 Drift + rollback (120 min)

- [ ] OBSERVE computes `drift`; below threshold → `loop.regression` + `calibration.update_rolled_back`; restore `before`.
- [ ] E2E test: simulated regression → rollback; successful lift → update settles as default.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/learning/src/loop.ts` | Loop stage machine + transitions |
| `packages/db/src/schema/learning.ts` (updated) | `loop_transitions` table |
| `packages/learning/src/events.ts` | Loop event payloads |
| `packages/learning/src/observe.ts` | Drift detection + rollback |
| `apps/api/src/scheduler.ts` (updated) | Continuous trigger |
| `packages/learning/src/__tests__/loop.test.ts` | Stage/idempotency/rollback tests |

---

## 5. Acceptance Criteria

- [ ] The four stages run continuously via scheduler, transitions persisted and auditable.
- [ ] Every stage transition emits its event with standard envelope + provenance; handlers are idempotent.
- [ ] DEPLOY advances only through shadow/A-B/human-approve; `notable_change` requires human sign-off.
- [ ] The loop never touches APPROVE/REJECT/`AUTO_APPROVABLE`.
- [ ] OBSERVE detects drift; a regression triggers rollback (restore `before`, emit `calibration.update_rolled_back`).
- [ ] E2E: simulated regression → rollback; lift → default (through A/B).
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **Continuous ≠ unchecked.** A loop that observes, tunes, and deploys every second with no gates, no idempotency, and no rollback is drift, not learning. The stage events + provenance are what make it "learning."
- **Idempotency is non-optional.** If two EVALUATE runs both fire CALIBRATE against the same results, you double-count samples and double-deploy. Dedup by `loop_transitions`.
- **Rollback is the safety property.** The loop's real guarantee isn't that it improves — it's that it *un-improves reversibly*. Without `calibration.update_rolled_back`, every deploy is a coin-flip with no undo.
- **Notable changes are human-gated.** The loop can prepare anything, but a parameter flip large enough to matter should not self-authorize. `notable_change` → human approval.
- **The human gate is not a loop input.** Task decisions (APPROVE/REJECT, AUTO_APPROVABLE) are outside the loop. The loop calibrates *parameters*; it never learns its way into replacing human attention.
- **Tomorrow (Day 34):** durable queue (Redis/SQS) behind `IEventBus` — contract unchanged, optional (Spec 2 §6).

---

*Prev: [Day 32 — Feedback Into Context Ranking: Learn Ranking Parameters From Usefulness](day-32.md) | Next: [Day 34 — Durable Queue (Redis/SQS) Behind `IEventBus` — Contract Unchanged, Optional](day-34.md)*
