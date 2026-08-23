# Day 11 — Calibration Dataset: Extract `was_useful` → Fit Set

| | |
|---|---|
| **Week** | W3 — Calibrate & gate auto-approve |
| **Spec refs** | Spec 6 §4.1 (feedback loop / `was_useful`), Spec 9 §3 (evidence = ground truth), Spec 11 §6 (attention calibration) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 10 (metrics checkpoint + Spec 10 promoted); `assessment_feedback` + `review_decisions.actor_id` populated |

---

## 1. Objectives

By end of day you will have:

1. A **calibration dataset** — a versioned, immutable extraction pipeline (`CalibrationExtractor`) that joins each `was_useful` feedback and assessment to its change **outcome** and emits a fit-ready table.
2. **Feature/label framing** — the assessment's factor scores (`risk/impact/novelty/complexity/confidence`) are features; the usefulness/outcome signal is the label.
3. A **coverage report** — how many assessments have labels, how many are missing (`was_useful IS NULL`), and class balance — so Week 3 never fits on a biased slice.
4. A **frozen fit set** stored in Postgres (`calibration_datasets`/`calibration_rows`), hash-sealed.

The Phase-1 weights (0.35/0.25/0.15/0.10/0.15) are explicit placeholders. Everything to Day 15 is the disciplined path from "we have usefulness feedback" to "the weights are fitted from it, and we can prove the fit is an improvement."

---

## 2. Design Decisions

### 2.1 The join — one row per *decided assessment*

```text
calibration_row
├── assessment_id            FK attention_assessments
├── factor_scores            { risk, impact, novelty, complexity, confidence }   ← features
├── combined_priority        (as computed with the placeholder weights)
├── was_useful               true | false | null                              ← label (primary)
├── outcome                  APPROVED | REJECTED | REWORKED | DEFECTED_LATER  ← label (secondary)
├── label_source             'feedback' | 'outcome'
└── run_id / task_id / change_id    ← provenance
```

**Why two labels?** `was_useful` is the reviewer's own signal (Spec 6 §4.1); `outcome` is the objective rework/defect signal (Spec 11 §4.1). Fit on the primary, validate against the secondary — a reviewer who says "useful" while the change still defects later is a divergence worth reporting.

### 2.2 The `was_useful = null` rule — record, don't impute

Missing feedback is an explicit `null` row, never converted to `false` and never dropped silently. If null share is high (> 40%), Week 3 must fit on the *outcome* label and flag the reviewer-feedback gap (a Spec 10 governance note).

### 2.3 Immutable, hash-sealed fit set

```sql
-- packages/db/migrations/0106_calibration.sql
CREATE TABLE calibration_datasets (
  id text PRIMARY KEY, row_count integer NOT NULL, label_source text NOT NULL,
  content_hash text NOT NULL, source_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE calibration_rows (
  dataset_id text NOT NULL REFERENCES calibration_datasets(id),
  assessment_id text NOT NULL, factor_scores jsonb NOT NULL, was_useful boolean,
  outcome text NOT NULL, label_source text NOT NULL,
  PRIMARY KEY (dataset_id, assessment_id));
```

`content_hash` covers the ordered rows; Day 12 records the `dataset_id` it consumed. Same append-only discipline as evidence — datasets are superseded, never mutated.

### 2.4 Where the extractor lives

`@harness/evaluation/src/calibration/extractor.ts` — read-only over `attention_assessments` + `assessment_feedback` + `review_decisions` + `task_state_history`. Pure function returning rows + hash; the writer persists them.

---

## 3. Tasks

### 3.1 Migration (45 min)
- [ ] `packages/db/migrations/0106_calibration.sql` — `calibration_datasets` + `calibration_rows`.

### 3.2 `CalibrationExtractor` (120 min)
- [ ] `packages/evaluation/src/calibration/extractor.ts` — the §2.1 join.
- [ ] `label_source` assignment and `DEFECTED_LATER` derivation (reuse Day-06's downstream-defect rule).

### 3.3 Coverage + balance report (60 min)
- [ ] `coverage` summary (labeled vs null, class balance); emit a Spec-10 governance note when null share > 40%.

### 3.4 Persist + seal (60 min)
- [ ] Writer: insert rows, compute `content_hash`, write `calibration_datasets`; `pnpm eval:make-dataset` CLI.

### 3.5 Tests (75 min)
- [ ] Known-answer join; null retains `label_source='outcome'`; hash determinism (extract twice → same; tamper → changes).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0106_calibration.sql` | Dataset + row tables |
| `packages/evaluation/src/calibration/{extractor,coverage,writer}.ts` | Extraction + coverage + persist |
| `packages/evaluation/src/__tests__/calibration.test.ts` | Known-answer + null + hash tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm eval:make-dataset` over the live DB writes `calibration_datasets` + `calibration_rows` and prints row count + null share.
- [ ] A seeded fixture with a known join produces exactly the expected rows.
- [ ] `was_useful IS NULL` rows are retained with `label_source='outcome'`.
- [ ] `content_hash` is deterministic across two extractions, and changes when one row changes.
- [ ] No `UPDATE`/`DELETE` path on `calibration_rows` (append-only).
- [ ] `pnpm --filter @harness/evaluation test` green.

---

## 6. Notes & Pitfalls

- **Do not drop nulls, and do not impute them.** A null share is a *finding* (reviewers aren't giving feedback), not something to paper over.
- **`was_useful` and `outcome` can disagree.** Treat disagreement as data; don't blend into one label before looking at the disagreement rate.
- **Freeze features at the factor level, not raw signals.** Reaching behind to raw diffs opens a second scoring pipeline that drifts from production.
- **The dataset is a point-in-time snapshot of a live pipeline.** Accumulate a new version rather than editing the old.
- **Beware of `DEFECTED_LATER` outcome leak.** A defect after the window looks like a clean approve inside it; state the lag horizon.
- **Next (Day 12):** fit the Attention weights on a train/validation split and run the before/after comparison.

---

*Prev: [Day 10 — Promote Spec 10 + Week 2 Metrics Checkpoint](day-10.md) | Next: [Day 12 — Weight Fitting: Attention Weights from Real Data](day-12.md)*