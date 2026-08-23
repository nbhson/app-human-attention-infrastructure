# Day 13 — Adaptive Thresholds & Alert-Fatigue Monitor (Spec 6 §4.1)

| | |
|---|---|
| **Week** | W3 — Calibrate & gate auto-approve |
| **Spec refs** | Spec 6 §4.1 (daily budget, adaptive thresholds, inflation monitoring, feedback loop), §3.4 (labels) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 12 (`WeightsProvider` + `calibration_weights`); Day 04 metrics (inflation ratio, usefulness counters) |

---

## 1. Objectives

By end of day you will have:

1. An **`AdaptiveThreshold` controller** in `@harness/attention-engine` that adjusts review thresholds (CRITICAL/HIGH cutoffs) from *observed* approval/rejection rates over a rolling window — bounded and logged, per Spec 6 §4.1.
2. A **daily review budget** gate — MEDIUM/LOW items beyond the budget defer to the next day; CRITICAL/HIGH always pass.
3. A **live inflation monitor** wired to the Day-04 gauge and the `attention.inflation_detected` event — driven by the *same real decision stream* Day 11 extracted, on the active (still-placeholder) weights until the fit earns promotion.
4. **Reversibility** — every adjustment is an emitted event with `before → after` and a stored rationale; the controller can be reverted to yesterday's values.

The Attention Engine cries wolf when its thresholds are wrong; fatigue destroys the trust the whole system runs on. Day 12 fitted the *weights* (honestly a non-win); today tunes the *decision boundary* using the same feedback loop, closed and auditable.

---

## 2. Design Decisions

### 2.1 Adaptive rule (from Spec 6 §4.1, made precise)

| Observed condition (rolling 30-day window) | Action |
|--------------------------------------------|--------|
| Approval rate in a band > ~95% | Raise that band's threshold a step (promote fewer) |
| Rejection / rework rate rising | Lower the threshold (promote more scrutiny) |
| CRITICAL+HIGH share > 30% ceiling | Emit `attention.inflation_detected` + governance note (**not** an auto-lower) |

The threshold stays bounded in `[0.60, 0.80]` for the HIGH cutoff — no amount of feedback drives it to degenerate "everything is CRITICAL" or "nothing is CRITICAL". Each change is one quantized step (e.g. ±0.02).

### 2.2 Threshold state — persisted, versioned, revert-able

```sql
-- packages/db/migrations/0108_thresholds.sql
CREATE TABLE attention_thresholds (
  id text PRIMARY KEY, project_id text NOT NULL, band text NOT NULL,
  cutoff double precision NOT NULL, min_bounds double precision NOT NULL, max_bounds double precision NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL,
  supersedes text REFERENCES attention_thresholds(id));
```

Each change is a new row referencing the one it supersedes (append-only). "Revert" applies the previous row's `cutoff`. No UPDATE on an existing row.

### 2.3 The decision boundary runs *after* fit, and never in the shadow path

The controller consumes the active `combined_priority` (still the placeholder weights while the fit is un-promoted) and the observed decision stream. It is a consumer of `review.decision_submitted`, not a producer of scores — it changes what *cutoff* applies, not how priority is *computed*.

### 2.4 Daily budget — a queue-time gate, not a scoring change

```text
remaining_budget = daily_review_budget - decisions_today
if item.priority_label in (CRITICAL, HIGH): route to human (always)
else if remaining_budget > 0: route to human, decrement
else: defer item (rewrite route with a deferred_until marker)
```

The budget lives in `AttentionPolicy` (Spec 6 §2.2); deferral is a recorded route decision, so "we deferred 3 items today" is a real metric.

---

## 3. Tasks

### 3.1 Migration + threshold store (45 min)
- [ ] Migration `0108_thresholds.sql` + `ThresholdStore` (insert `supersedes`, read active, revert).

### 3.2 `AdaptiveThreshold` controller (120 min)
- [ ] `packages/attention-engine/src/thresholds/adaptive-threshold.ts` — approval/rejection rates per band → §2.1 step rule → emit `attention.threshold_adjusted{band, before, after, reason}`.
- [ ] Clamp to bounds; no-op below a minimum window size (don't adapt on 3 data points).

### 3.3 Daily budget gate (90 min)
- [ ] `packages/attention-engine/src/thresholds/daily-budget.ts` — §2.4 logic; emit `attention.item_deferred`.

### 3.4 Inflation monitor (60 min)
- [ ] Read the CRITICAL+HIGH share gauge; >30% → `attention.inflation_detected` + governance note (no auto-lower).

### 3.5 Tests (105 min)
- [ ] 0.97 approval → HIGH cutoff +1 step, event carries `before/after`, supersedes row written.
- [ ] Bounds: 20 raises clamp at 0.80; 20 lowers at 0.60.
- [ ] Too-small window → no-op. Budget defers only MEDIUM/LOW. Inflation alerts but doesn't change thresholds. Revert restores prior cutoff.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0108_thresholds.sql` | `attention_thresholds` |
| `packages/attention-engine/src/thresholds/{adaptive-threshold,daily-budget,threshold-store}.ts` | Controllers + store |
| `packages/attention-engine/src/__tests__/adaptive-threshold.test.ts` | §3.5 matrix |

---

## 5. Acceptance Criteria

- [ ] Approval rate > 0.95 → HIGH cutoff rises exactly one step and `attention.threshold_adjusted` publishes with `before`/`after`.
- [ ] 20 raises clamp at 0.80; 20 lowers clamp at 0.60.
- [ ] Below minimum window size → no change.
- [ ] `attention_thresholds` append-only; revert restores the prior cutoff (`supersedes` intact).
- [ ] Daily budget defers only MEDIUM/LOW; CRITICAL/HIGH always route.
- [ ] Inflation > 30% emits `attention.inflation_detected` but does **not** change thresholds.
- [ ] `grep -r "threshold" packages/attention-engine/src` shows no direct scalar mutation.
- [ ] `pnpm --filter @harness/attention-engine test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Adaptive is not autonomous-cascade.** Each adjustment is one small bounded step, emitted as an event, reversible.
- **Don't adapt on tiny windows.** A threshold flailing on 3 decisions is the alert-fatigue failure inside-out.
- **Inflation is a *signal to a human*, not an auto-lower.** Spec 6 §4.1 is explicit.
- **Revert-ability is only real if tested.** Exercise "revert" in a test that flips the value back.
- **Budget deferral must be visible.** A deferred item that silently vanishes is a data-loss bug; deferral is a recorded route decision.
- **Next (Day 14):** surface calibration + adaptive thresholds behind the `AUTO_APPROVABLE` flag with a kill-switch and sampling audit, gated on calibration green.

---

*Prev: [Day 12 — Weight Fitting: Attention Weights from Real Data](day-12.md) | Next: [Day 14 — Auto-Approve: Flag, Kill-Switch & Sampling Audit](day-14.md)*