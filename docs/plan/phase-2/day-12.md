# Day 12 — Weight Fitting: Attention Weights from Real Data

| | |
|---|---|
| **Week** | W3 — Calibrate & gate auto-approve |
| **Spec refs** | Spec 6 §3.4 (combined-priority formula + weights), §4.1 (feedback loop); Spec 11 §6 (attention calibration, "fit must earn promotion") |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 11 (`calibration_datasets`/`calibration_rows` + extractor); Phase-1 placeholder weights 0.35/0.25/0.15/0.10/0.15 |

---

## 1. Objectives

By end of day you will have:

1. A **`WeightFitter`** that fits the five Attention weights (`risk`, `impact`, `novelty`, `complexity`, `confidence`) from a calibration dataset via a train/validation split.
2. A **before/after comparison** on the held-out set — placeholder weights vs fitted weights — reported as a measurable log-loss/ranking-accuracy result, not an assertion.
3. A **published weights artifact** (versioned, dataset-linked) consumable via a `WeightsProvider` seam.
4. The **honest verdict recorded**: a fit that does **not** beat the placeholder stays non-promoted — the placeholder remains the default, and the loss is written up, not papered over.

This is where "confidence without evidence" ends. The weights stop being opinions and become a fitted parameter with a recorded provenance chain — **and if the fit can't beat the placeholder, the correct outcome is to keep the placeholder and say so.**

---

## 2. Design Decisions

### 2.1 Fit objective — a binary "did this assessment deserve attention?"

```text
y = 1  if outcome ∈ {REJECTED, REWORKED, DEFECTED_LATER}   (attention was warranted)
y = 0  if outcome ∈ {APPROVED}
P(y=1) = σ( Σ wᵢ · factorᵢ + (1 - confidence_score)·w_confidence )
```

- **Features** are the five factor scores; confidence enters as the *deficit* `(1 - confidence_score)` per Spec 6 §3.4 — low confidence must raise priority.
- **Constraint:** weights ≥ 0 and Σw = 1. v0 uses unconstrained logistic fit + L1 normalization, documented as a simplification.
- **Baseline vs fitted metric:** `log_loss` (lower better) and `ranking_accuracy` on the same validation split.

### 2.2 Train / validation split — stratified, seeded, reproducible

Stratify on `outcome`; seed the split and record it in dataset metadata. The validation set is held out from fitting and used only for the before/after comparison.

### 2.3 The weights artifact — versioned, dataset-linked

```sql
-- packages/db/migrations/0107_weights.sql
CREATE TABLE calibration_weights (
  id text PRIMARY KEY, dataset_id text NOT NULL REFERENCES calibration_datasets(id),
  method text NOT NULL, weights jsonb NOT NULL,
  log_loss_fitted double precision NOT NULL,
  log_loss_placeholder double precision NOT NULL,
  ranking_accuracy_fitted double precision NOT NULL,
  ranking_accuracy_placeholder double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
```

The Attention Engine resolves a `WeightsProvider` returning the **active** weight vector; today that is still the placeholder via `StaticWeightsAdapter`.

### 2.4 Before/after is a *report*, not a gut-check — and a non-win keeps the placeholder

The fitter emits a `FitReport`: placeholder vs fitted log-loss and ranking-accuracy on validation. If fitted does **not** beat placeholder, the fit is a **non-result** — the placeholder stays and the failure is written up (governance note).

> **Recorded outcome (Phase 2):** the fit ran on the real N-window dataset and produced `log_loss_fitted = 0.316`, which did **not** beat the placeholder's `0.262` on the held-out set. Per Spec 11 §6 the guardrail held: `StaticWeightsAdapter` was **not** auto-promoted, `eval:fit` printed `improvement: false`, and the placeholder returned as the active weights (wiring-map line 38). "Calibrated weights" remains aspirational — this is an honest △, carried into Phase 3, not a regression dressed as progress.

---

## 3. Tasks

### 3.1 Migration + `WeightsProvider` seam (60 min)
- [ ] Migration `0107_weights.sql`.
- [ ] `packages/attention-engine/src/weights/weights-provider.ts` — `getActiveWeights()`; `StaticWeightsAdapter` returning placeholders (default).

### 3.2 `WeightFitter` (150 min)
- [ ] `packages/evaluation/src/calibration/weight-fitter.ts`: stratified split; fit on train; evaluate placeholder vs fitted on validation (log-loss + ranking accuracy).
- [ ] Implement linear algebra by hand (no heavy ML dep); the split/eval logic must be pure and testable.

### 3.3 Fit report + persistence (90 min)
- [ ] Persist `calibration_weights` (always) + a `FitReport` with before/after numbers; `pnpm eval:fit --dataset <id>` CLI.

### 3.4 Known-answer tests (120 min)
- [ ] One perfectly-predictive factor → its fitted weight dominates (ordering asserted).
- [ ] Split reproducibility: same seed + dataset → identical membership.
- [ ] Normalization: weights sum to 1 (± 1e-3), all ≥ 0.
- [ ] Non-result path: label independent of features → `improvement: false`, report flags "no improvement".

### 3.5 Wire provider (60 min)
- [ ] Register `TOKENS.WeightsProvider` with the static adapter; engine still computes with placeholders (behavior unchanged today).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0107_weights.sql` | `calibration_weights` |
| `packages/attention-engine/src/weights/weights-provider.ts` | `WeightsProvider` seam + static adapter |
| `packages/evaluation/src/calibration/{weight-fitter,fit-report}.ts` | Fitter + split + before/after |
| `packages/evaluation/src/__tests__/weight-fitter.test.ts` | Known-answer + split + non-result tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm eval:fit --dataset <id>` writes `calibration_weights` and prints placeholder-vs-fitted log-loss and ranking accuracy.
- [ ] A seeded dominant-factor dataset yields the fitted weight as the largest (ordering asserted).
- [ ] Fitted weights sum to 1 (± 1e-3) and every weight ≥ 0.
- [ ] Same seed + dataset → identical split; different seed → different split.
- [ ] A non-predictive dataset yields `improvement: false`, and the operator is told the placeholder stays.
- [ ] The honest result is honored: when fitted (0.316) loses to placeholder (0.262), the `StaticWeightsAdapter` remains active and `eval:fit` reports `improvement: false`.
- [ ] The engine still computes with placeholders after today; no engine imports another engine; `pnpm lint` + typecheck green.

---

## 6. Notes & Pitfalls

- **Don't promote a fit that doesn't beat the placeholder.** Spec 11 §6 is explicit: no automatic behavior change without measured evidence it doesn't reduce safety. A "looks better" vector is not evidence.
- **`confidence` enters as the deficit.** The feature is `(1 - confidence_score)`; fitting on the raw score inverts the sign. This is the single most likely bug today.
- **Beware of leakage into the split.** Split at the *assessment* level; keep a change's `DEFECTED_LATER` with the same assessment row.
- **v0 fit is logistic-on-scores, not a causal model.** Document predictive-vs-causal in the report.
- **The honest loss is a win for the system.** The fact that the fit lost (0.316 vs 0.262) and was *held back* is exactly the discipline Phase 2 exists to prove. Do not paper it over — record it as the △ in Day 30's exit review and carry "re-run the fit once data accumulates" into Phase 3.
- **Next (Day 13):** adaptive thresholds + alert-fatigue monitor from the same real data.

---

*Prev: [Day 11 — Calibration Dataset: Extract `was_useful` → Fit Set](day-11.md) | Next: [Day 13 — Adaptive Thresholds & Alert-Fatigue Monitor (Spec 6 §4.1)](day-13.md)*