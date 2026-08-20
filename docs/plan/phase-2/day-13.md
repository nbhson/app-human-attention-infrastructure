# Day 13 — Adaptive Thresholds & Alert-Fatigue Monitor (Spec 6 §4.1)

| | |
|---|---|
| **Week** | 3 — Calibrate & gate auto-approve |
| **Spec refs** | Spec 6 §4.1 (daily budget, adaptive thresholds, inflation monitoring, feedback loop), §3.4 (labels) |
| **Estimated effort** | 7 hours |
| **Prerequisites** | Day 12 (`WeightsProvider` + `calibration_weights`); Day 04 metrics (inflation ratio, usefulness counters) |

---

## 1. Objectives

By end of day you will have:

1. An **`AdaptiveThreshold` controller** in `@harness/attention-engine` that adjusts the review thresholds (the `combined_priority` cutoffs for CRITICAL/HIGH/MEDIUM/LOW) based on *observed* approval/rejection rates over a rolling window — per Spec 6 §4.1, bounded and logged.
2. A **daily review budget** gate — MEDIUM/LOW items beyond the budget are deferred to the next day; CRITICAL/HIGH always pass.
3. A **live inflation monitor** wired to the Day-04 gauge and the `attention.inflation_detected` event (Phase-1) — now sourced from real fitted-priority data, not the placeholder run.
4. **Reversibility** — every threshold adjustment is an emitted event with `before → after` and a stored rationale, and the controller can be reverted to yesterday's values.

The Attention Engine cries wolf when its thresholds are wrong; fatigue destroys the trust the whole system runs on. Day 12 fitted the *weights*; today tunes the *decision boundary* using the same feedback loop, closed and auditable.

---

## 2. Design Decisions

### 2.1 Adaptive rule (from Spec 6 §4.1, made precise)

| Observed condition (rolling 30-day window) | Action |
|--------------------------------------------|--------|
| Approval rate in a band > ~95% | Raise that band's threshold by a step (promote fewer) |
| Rejection / rework rate rising | Lower the threshold (promote more scrutiny) |
| CRITICAL+HIGH share > 30% ceiling | Emit `attention.inflation_detected` + governance note (**not** an auto-lower) |

The threshold stays **bounded** in `[0.60, 0.80]` for the HIGH cutoff (Spec 6 §4.1's demonstrated range), so no amount of feedback drives it to a degenerate "everything is CRITICAL" or "nothing is CRITICAL". Every change is a single quantized step (e.g. ±0.02), not a jump — small, reversible, inspect-able.

### 2.2 Threshold state — persisted, versioned, revert-able

```sql
-- packages/db/migrations/0108_thresholds.sql
CREATE TABLE attention_thresholds (
  id           text PRIMARY KEY,               -- UUIDv7
  project_id   text NOT NULL,
  band         text NOT NULL,                  -- 'HIGH' | 'CRITICAL' (MEDIUM/LOW fixed in v0)
  cutoff       double precision NOT NULL,
  min_bounds   double precision NOT NULL,
  max_bounds   double precision NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  reason       text NOT NULL,                  -- "approval_rate 0.97 > 0.95"
  supersedes   text REFERENCES attention_thresholds(id)   -- previous value
);
```

Each change is a new row referencing the one it supersedes (append-only history, mirroring evidence/Spec 9 §3.2). "Revert" = apply the previous row's `cutoff`. No UPDATE on an existing row.

### 2.3 The decision boundary runs *after* fit, and never in the shadow path

The controller consumes the *active* `combined_priority` (from Day 12's active weights — still placeholder until the flag flips) and the observed decision stream. It is a consumer of `review.decision_submitted`/`reportAssessmentFeedback`, not a producer of scores — it changes what *cutoff* is applied, not how the priority is *computed*.

### 2.4 Daily budget — a queue-time gate, not a scoring change

```text
remaining_budget = daily_review_budget - decisions_today
if item.priority_label in (CRITICAL, HIGH): route to human (always)
else if remaining_budget > 0: route to human, decrement
else: defer item to next day (rewrite its route with a `deferred_until` marker)
```

The budget lives in `AttentionPolicy` (Spec 6 §2.2's policy surface); the gate is applied when the review item is *routed*, and a `deferral` is a recorded route decision (so the metric "we deferred 3 items today" is real, not inferred).

---

## 3. Tasks

### 3.1 Migration + threshold store (45 min)

- [ ] Migration `0108_thresholds.sql` (§2.2) + a `ThresholdStore` (insert `supersedes`, read active, revert).

### 3.2 `AdaptiveThreshold` controller (120 min)

- [ ] `packages/attention-engine/src/thresholds/adaptive-threshold.ts` — compute approval/rejection rates per band → apply §2.1's step rule → emit `attention.threshold_adjusted{band, before, after, reason}`.
- [ ] Clamp to bounds; no-op when the window is too small (< N decisions, configurable — don't adapt on 3 data points).

### 3.3 Daily budget gate (90 min)

- [ ] `packages/attention-engine/src/thresholds/daily-budget.ts` — §2.4 logic; emit `attention.item_deferred` when deferring.
- [ ] Wire into the routing path (after `attention.item_routed`, before queue insertion).

### 3.4 Inflation monitor (60 min)

- [ ] Read the CRITICAL+HIGH share gauge; on >30% emit `attention.inflation_detected` + a Spec-10 governance note (no auto-lower).
- [ ] Reuse the threshold store's history for a "who changed what when" audit query.

### 3.5 Tests (105 min)

- [ ] Approval rate 0.97 → HIGH cutoff raised by one step, event carries `before/after`, supersedes row written.
- [ ] Bounds: 20 consecutive "raise" calls never exceed 0.80, 20 "lower" never below 0.60.
- [ ] Too-small window → no-op (no spurious adaptation on 3 items).
- [ ] Budget: 2 of 5 MEDIUM items deferred when budget is 3; CRITICAL/HIGH routed regardless.
- [ ] Inflation: share > 30% → event emitted, **threshold unchanged** (monitor alerts, doesn't auto-adjust).
- [ ] Revert: applying the prior row restores the prior cutoff.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0108_thresholds.sql` | `attention_thresholds` |
| `packages/attention-engine/src/thresholds/{adaptive-threshold,daily-budget}.ts` | Controllers |
| `packages/attention-engine/src/thresholds/threshold-store.ts` | Append-only, reverting store |
| `packages/attention-engine/src/__tests__/adaptive-threshold.test.ts` | §3.5 matrix |

---

## 5. Acceptance Criteria

- [ ] On a seeded window with approval rate > 0.95, the HIGH cutoff rises by exactly one step and `attention.threshold_adjusted` is published with `before`/`after`.
- [ ] 20 consecutive raises clamp at 0.80; 20 lowers clamp at 0.60 (bounds hold).
- [ ] A window below the minimum size triggers **no** threshold change.
- [ ] `attention.thresholds` history is append-only and revert restores the prior cutoff (`supersedes` chain intact).
- [ ] Daily budget defers only MEDIUM/LOW; CRITICAL/HIGH always route.
- [ ] Inflation > 30% emits `attention.inflation_detected` but does **not** change thresholds.
- [ ] `grep -r "threshold" packages/attention-engine/src` shows no direct scalar mutation — all changes go through the store.
- [ ] `pnpm --filter @harness/attention-engine test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Adaptive is not autonomous-cascade.** Each adjustment is one small bounded step, emitted as an event, and reversible. A controller that can re-tune itself to the moon in one afternoon is a *second* AI you didn't ask for.
- **Don't adapt on tiny windows.** Thresholds tuned on 3 decisions are noise. The controller must refuse below a minimum N (and log the refusal). This is the alert-fatigue failure inside-out: a threshold that flails creates the fatigue.
- **Inflation is a *signal to a human*, not an auto-lower.** Spec 6 §4.1 is explicit: rising CRITICAL/HIGH share is either miscalibration or a real risk-profile change — a human distinguishes those, a controller can't.
- **Revert-ability is only real if it's tested.** The `supersedes` chain means nothing if "revert" isn't exercised in a test that flips the value back. Write it, don't assume it.
- **Budget deferral must be visible.** A deferred item that silently vanishes from the queue is a data-loss bug. Deferral is a *route decision* recorded with a `deferred_until` marker, not a drop.
- **Next (Day 14):** surface the whole calibration — fitted weights + adaptive thresholds — behind the `AUTO_APPROVABLE` flag with a kill-switch and sampling audit, gated on today's monitors being green.

---

*Prev: [Day 12 — Weight Fitting: Attention Weights from Real Data](day-12.md) | Next: [Day 14 — Auto-Approve: Flag, Kill-Switch & Sampling Audit](day-14.md)*
