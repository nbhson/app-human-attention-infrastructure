# Day 12 — Weight Fitting: Attention Weights from Real Data

| | |
|---|---|
| **Week** | 3 — Calibrate & gate auto-approve |
| **Spec refs** | Spec 6 §3.4 (combined-priority formula + weights), §4.1 (feedback loop); Spec 11 §6 (attention calibration) |
| **Estimated effort** | 8 hours |
| **Prerequisites** | Day 11 (`calibration_datasets`/`calibration_rows` + extractor); Phase-1 weights 0.35/0.25/0.15/0.10/0.15 as placeholders |

---

## 1. Objectives

By end of day you will have:

1. A **`WeightFitter`** that fits the five Attention weights (`risk`, `impact`, `novelty`, `complexity`, `confidence`) from a calibration dataset — replacing the hard-coded placeholder constants with a data-derived vector.
2. A **train/validation split** with a held-out validation set, so a fit is judged on data it did not see.
3. A **before/after comparison** on the *same* held-out set — placeholder weights vs fitted weights — reported as a measurable improvement (log-loss / ranking accuracy), not an assertion.
4. A **published weights artifact** (versioned, dataset-linked) that the Attention Engine can consume via a `WeightsProvider` seam — but **not yet flip live** (that's gated on the inflation monitor, Day 13, and the auto-approve flag, Day 14).

This is where "confidence without evidence" ends. The weights stop being opinions and become a fitted parameter, with a recorded provenance chain: which dataset, which split, which objective, which result.

---

## 2. Design Decisions

### 2.1 Fit objective — treated as a binary "did this assessment deserve attention?"

The combined-priority formula (Spec 6 §3.4) is linear in weights. We fit weights by **logistic regression** on the label:

```text
y = 1  if outcome ∈ {REJECTED, REWORKED, DEFECTED_LATER}   (attention was warranted)
y = 0  if outcome ∈ {APPROVED}                               (attention was not warranted)

P(y=1) = σ( Σ wᵢ · factorᵢ + (1 - confidence_score)·w_confidence )
```

- **Features** are the five factor scores from the dataset (Day 11). Confidence enters as the *deficit* `(1 - confidence_score)` exactly as Spec 6 §3.4 specifies — low confidence must raise priority.
- **Constraint:** weights ≥ 0 and Σw = 1 (they are a convex combination, per the spec's guarantee that `combined_priority ∈ [0,1]`). Fit unconstrained, then normalize; or use a constrained solver. v0 uses unconstrained logistic fit + L1 normalization, documented as a known simplification.
- **Baseline vs fitted metric:** `log_loss` (lower is better) and `ranking_accuracy` (did the fitted weights rank a warranted review above a non-warranted one?). Report both for placeholder and fitted weights on the same validation split.

### 2.2 Train / validation split — stratified, seeded, reproducible

Stratify on `outcome` so both splits carry the same approve/rework/defect ratio; seed the split with a fixed value recorded in the dataset metadata, so two people fitting "the same dataset" get the same splits. The validation set is **held out** from fitting and used only for the before/after comparison.

### 2.3 The weights artifact — versioned, dataset-linked

```sql
-- packages/db/migrations/0107_weights.sql
CREATE TABLE calibration_weights (
  id           text PRIMARY KEY,               -- UUIDv7 (weight version)
  dataset_id   text NOT NULL REFERENCES calibration_datasets(id),
  method       text NOT NULL,                  -- "logistic-regression-v0"
  weights      jsonb NOT NULL,                 -- { risk, impact, novelty, complexity, confidence }
  log_loss_fitted    double precision NOT NULL,
  log_loss_placeholder double precision NOT NULL,
  ranking_accuracy_fitted double precision NOT NULL,
  ranking_accuracy_placeholder double precision NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

The Attention Engine resolves a `WeightsProvider` (interface added to `@harness/attention-engine`) that returns the **active** weight vector. Today the provider still returns the placeholder constants (active-weights row is created but the engine is not re-pointed until Day 13/14; see §6).

### 2.4 Before/after is a *report*, not a gut-check

The fitter emits a `FitReport`: placeholder vs fitted log-loss and ranking-accuracy on validation, plus the fitted weight vector. If fitted does **not** beat placeholder on validation (or the improvement is within noise), the fit is a **non-result** — the placeholder stays, and the failure is written up (governance note). A fit must earn its promotion, exactly like a variant must beat the incumbent (Day 09).

---

## 3. Tasks

### 3.1 Migration + `WeightsProvider` seam (60 min)

- [ ] Migration `0107_weights.sql` (§2.3).
- [ ] `packages/attention-engine/src/weights/weights-provider.ts` — interface `getActiveWeights(): Promise<AttentionWeights>`; a `StaticWeightsAdapter` returning placeholders (default).

### 3.2 `WeightFitter` (150 min)

- [ ] `packages/evaluation/src/calibration/weight-fitter.ts`:
  - stratified split (seeded);
  - fit (unconstrained logistic + normalize) on train;
  - evaluate placeholder vs fitted on validation (log-loss + ranking accuracy).
- [ ] Implement the v0 linear-algebra by hand (no heavy ML dep) or with a tiny pinned dep — but the split/eval logic must be pure and testable.

### 3.3 Fit report + persistence (90 min)

- [ ] Persist `calibration_weights` row (always), and write a `FitReport` doc/JSON with the before/after numbers.
- [ ] `pnpm eval:fit --dataset <id>` CLI.

### 3.4 Known-answer tests (120 min)

- [ ] A synthetic dataset where one factor is perfectly predictive → fitted weight for that factor dominates; assert ordering, not exact value (fits are approximate).
- [ ] Split reproducibility: same seed + same dataset → identical train/validation membership.
- [ ] Normalization: fitted weights sum to 1 within tolerance and are all ≥ 0.
- [ ] Non-result path: a dataset where label is independent of features → fitted ~ placeholder; the report flags "no improvement".

### 3.5 Wire provider (60 min)

- [ ] Register `TOKENS.WeightsProvider` with the static adapter; confirm the engine still computes with placeholders (behavior unchanged today).
- [ ] `docs/architecture/wiring-map.md` update.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0107_weights.sql` | `calibration_weights` |
| `packages/attention-engine/src/weights/weights-provider.ts` | `WeightsProvider` seam + static adapter |
| `packages/evaluation/src/calibration/weight-fitter.ts` | Fitter + split + before/after |
| `packages/evaluation/src/calibration/fit-report.ts` | `FitReport` |
| `packages/evaluation/src/__tests__/weight-fitter.test.ts` | Known-answer + split + non-result tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm eval:fit --dataset <id>` fits weights, writes `calibration_weights`, and prints placeholder-vs-fitted log-loss and ranking accuracy.
- [ ] On a seeded dataset with a dominant factor, the fitted weight for that factor is the largest (ordering asserted).
- [ ] Fitted weights sum to 1 (± 1e-3) and every weight ≥ 0.
- [ ] Same seed + dataset → identical split; different seed → different split (test both).
- [ ] A non-predictive dataset yields a `FitReport` with `improvement: false` — and the operator is told the placeholder stays.
- [ ] The Attention Engine still computes with placeholder weights after today (static adapter default): `SELECT weights FROM calibration_weights` adds rows but the live engine path is unchanged (assert via a unit test on the provider).
- [ ] No engine imports another engine; `pnpm lint` + `pnpm -r typecheck` green.

---

## 6. Notes & Pitfalls

- **Don't promote a fit that doesn't beat the placeholder.** Spec 11 §6's guardrail is explicit: no automatic behavior change without measured evidence it doesn't reduce safety. A "looks better" weight vector is not evidence; a *validation-set log-loss improvement* is.
- **`confidence` enters as the deficit.** The feature is `(1 - confidence_score)`, not `confidence_score`. Fitting on the raw score inverts the relationship (high confidence should *lower* priority) and the fit will learn the wrong sign. This is the single most likely bug today.
- **Beware of leakage into the split.** Split at the *assessment* level, and keep a change's downstream defect (`DEFECTED_LATER`) with the *same* assessment row that produced it — never let the label leak across the split boundary.
- **v0 fit is logistic-on-scores, not a causal model.** If a factor is collinear with another, the fit redistributes weight in a way that predicts but doesn't "explain". Document the fit as predictive, not causal, in the report.
- **The provider seam stays on placeholders today on purpose.** This is the discipline of shadow-then-default applied to weights: fit and measure *first* (today + Day 13), flip only after inflation monitor is green and auto-approve is flag-gated (Day 14). Resist wiring the fitted vector live "just to see".
- **Next (Day 13):** adaptive thresholds + the alert-fatigue monitor, driven by the same real data, before the auto-approve flag can be flipped.

---

*Prev: [Day 11 — Calibration Dataset: Extract `was_useful` → Fit Set](day-11.md) | Next: [Day 13 — Adaptive Thresholds & Alert-Fatigue Monitor (Spec 6 §4.1)](day-13.md)*
