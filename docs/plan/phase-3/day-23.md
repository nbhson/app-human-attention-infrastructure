# Day 23 — Judge Signals → Attention-weight Fitting (`was_useful`)

| | |
|---|---|
| **Week** | 5 — Review-quality calibration |
| **Spec refs** | Spec 6 (attention weights, calibration); Phase-2 calibration seam; Phase-3 README §3 (attention-engine gains judge signals) |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 21–22 (judge scores + agreement); Phase-2 weight-fitter (`weight-fitter`) exists |

---

## 1. Objectives

By end of day you will have:

1. A **joined calibration dataset**: per review — `was_useful` (the human's usefulness mark) + judge scores (severity/routing agreement) + attention factors → one fit-ready row.
2. Extend the Phase-2 weight-fitter to include **judge signals as a factor**, refitting attention weights so judge-flagged reports route more accurately.
3. The refit stays behind the A/B harness — **fitted, then measured against the Phase-2/placeholder weights** before any default change.
4. An inflation-monitor before/after comparison (Phase-2 pattern) to show the refit helps or holds.

This is where review-quality measurement starts *improving* attention — gated on measurement, as always.

---

## 2. Design Decisions

### 2.1 `was_useful` + judge = the label and the feature

- Label: `was_useful` (did the human find the review useful / agree with its routing) — the Phase-2 outcome signal.
- New feature: judge `routingAgreement`/`severityAgreement` scores for that report (from `judge_runs`/agreement), joined by report id.
- The weight-fitter learns how much to trust judge-flagged disagreement when predicting usefulness.

### 2.2 Refit is a *candidate*, not a default

The fitted vector is written as a **candidate weight set**, compared via the A/B harness against the incumbent (placeholder or Phase-2 fitted). Promotion is Day 25's checkpoint decision — nothing flips today.

### 2.3 Guard divergence

If judge signals make the fit dramatically overweight a single factor (overfit on N small), the inflation-monitor/regularization holds it back — same discipline as Phase 2's "fitted but not improved → held".

---

## 3. Tasks

### 3.1 Calibration dataset build (90 min)

- [ ] `packages/attention-engine/src/calibration/judge-dataset.ts` — join review + `was_useful` + judge scores + factors.

### 3.2 Extend weight-fitter (90 min)

- [ ] Add judge-signal feature(s) to the fitter; refit; emit candidate weights + fit diagnostics.

### 3.3 A/B harness wiring (60 min)

- [ ] Register candidate weight set as a `PipelineVariant` for head-to-head comparison.

### 3.4 Inflation-monitor (60 min)

- [ ] Before/after usefulness/uplift report on the fit set.

### 3.5 Tests (60 min)

- [ ] Dataset join correct; fitter consumes judge features; candidate set runnable by the harness; no default flip.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/attention-engine/src/calibration/judge-dataset.ts` | Joined calibration dataset |
| `packages/attention-engine/src/calibration/weight-fitter.ts` (updated) | Judge-signal feature + refit |
| `packages/evaluation/src/ab/…` (updated) | Candidate weight variant |
| `packages/attention-engine/src/__tests__/judge-fit.test.ts` | Fit tests |

---

## 5. Acceptance Criteria

- [ ] Calibration dataset joins `was_useful` + judge scores + factors per review.
- [ ] Weight-fitter refits including judge signals; emits candidate weights + diagnostics.
- [ ] Candidate set loads as an A/B variant; incumbent unchanged.
- [ ] Inflation-monitor shows before/after on the fit set (uplift or hold).
- [ ] No default weight set flipped today.

---

## 6. Notes & Pitfalls

- **Fitted ≠ promoted.** Phase 2's caution is warp-and-weft: a fit that didn't beat the placeholder was *held*. Judge signals only earn their weight by improving usefulness, measured.
- **Small-N overfit is the enemy.** Judge scores on a handful of reviews will overfit; regularization/monitor is not optional garnish.
- **Keep the human label authoritative.** Judge scores are a *feature*; `was_useful` is the *label*. Never invert that — the judge predicts, the human decides.
- **Day 24:** review-quality corpus — versioned gold labels.

---

*Next: [Day 24 — Review-quality Corpus: Versioned Gold Labels](day-24.md)*