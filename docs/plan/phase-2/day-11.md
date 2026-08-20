# Day 11 — Calibration Dataset: Extract `was_useful` → Fit Set

| | |
|---|---|
| **Week** | 3 — Calibrate & gate auto-approve |
| **Spec refs** | Spec 6 §4.1 (feedback loop / `was_useful`), Spec 9 §3 (evidence = ground truth), Spec 11 §6 (attention calibration) |
| **Estimated effort** | 6 hours |
| **Prerequisites** | Day 10 (metrics checkpoint + Spec 10 promoted); `assessment_feedback` + `review_decisions.actor_id` populated by real runs |

---

## 1. Objectives

By end of day you will have:

1. A **calibration dataset** — a versioned, immutable extraction pipeline (`CalibrationExtractor`) that joins each `was_useful` feedback and assessment to its change **outcome** (approved/rejected/reworked/defect) and emits a fit-ready table.
2. **Feature/label framing** — the assessment's factor scores (`risk/impact/novelty/complexity/confidence`) are the features; the usefulness/outcome signal is the label. Features are what Week 3 fits weights against.
3. A **coverage report** — how many assessments have labels, how many are missing (`was_useful IS NULL`), and the class balance — so Week 3 never fits on a biased slice.
4. **A frozen fit set** stored in Postgres (`calibration_datasets` / `calibration_rows`), hash-sealed so the same fit is reproducible and a later "retcon" of the data is impossible.

The Phase-1 weights (0.35/0.25/0.15/0.10/0.15) are explicit placeholders. Everything from here to Day 15 is the disciplined path from "we have usefulness feedback" to "the weights are fitted from that feedback, and we can prove the fit is an improvement."

---

## 2. Design Decisions

### 2.1 The join — one row per *decided assessment*

```text
calibration_row
├── assessment_id            FK attention_assessments
├── factor_scores            { risk, impact, novelty, complexity, confidence }   ← features
├── combined_priority        (as computed at the time, with the placeholder weights)
├── was_useful               true | false | null                              ← label (primary)
├── outcome                  APPROVED | REJECTED | REWORKED | DEFECTED_LATER  ← label (secondary)
├── label_source             'feedback' | 'outcome'                            ← which produced the label
├── run_id / task_id / change_id                                               ← provenance
└── extracted_at             timestamptz
```

**Why two labels?** `was_useful` is the reviewer's own signal (Spec 6 §4.1's feedback loop); `outcome` is the objective rework/defect signal (Spec 11 §4.1's ground truth). Fitting on the *primary* (subjective) label but validating against the *secondary* (objective) label catches a reviewer who says "useful" while the change still defects later. Divergence between the two is itself a report line.

### 2.2 The `was_useful = null` rule — record, don't impute

Missing feedback is an explicit `null` row, never converted to `false` and never dropped silently. The coverage report counts nulls; if null share is high (say > 40%), Week 3 must fit on the *outcome* label instead and flag the reviewer-feedback gap (a governance note for Spec 10).

### 2.3 Immutable, hash-sealed fit set

```sql
-- packages/db/migrations/0106_calibration.sql
CREATE TABLE calibration_datasets (
  id          text PRIMARY KEY,                -- UUIDv7, also the dataset version
  created_at  timestamptz NOT NULL DEFAULT now(),
  row_count   integer NOT NULL,
  label_source text NOT NULL,
  content_hash text NOT NULL,                  -- SHA256 over the ordered row set
  source_version text NOT NULL
);
CREATE TABLE calibration_rows (
  dataset_id  text NOT NULL REFERENCES calibration_datasets(id),
  assessment_id text NOT NULL,
  factor_scores jsonb NOT NULL,
  was_useful  boolean,
  outcome     text NOT NULL,
  label_source text NOT NULL,
  PRIMARY KEY (dataset_id, assessment_id)
);
```

The `content_hash` covers the ordered rows; a fit (Day 12) records the `dataset_id` it consumed, so the exact input is reconstructable. Same append-only discipline as evidence (§9) — datasets are never mutated, only superseded by a new version.

### 2.4 Where the extractor lives

`@harness/evaluation/src/calibration/extractor.ts` — read-only over `attention_assessments` + `assessment_feedback` + `review_decisions` + `task_state_history` (defect-later). Pure function returning rows + `content_hash`; the writer persists them. This keeps extraction reproducible and unit-testable without a live DB in the compute path.

---

## 3. Tasks

### 3.1 Migration (45 min)

- [ ] `packages/db/migrations/0106_calibration.sql` — `calibration_datasets` + `calibration_rows` (§2.3).

### 3.2 `CalibrationExtractor` (120 min)

- [ ] `packages/evaluation/src/calibration/extractor.ts` — the §2.1 join.
- [ ] `label_source` assignment: `was_useful` non-null → `'feedback'`; else outcome-based `'outcome'`.
- [ ] `outcome` derivation incl. `DEFECTED_LATER` (prior fly-through that later reworked — reuse Day-06's downstream-defect rule).

### 3.3 Coverage + balance report (60 min)

- [ ] `coverage` summary: labeled vs null, class balance across labels, per-label counts.
- [ ] Emit a Spec-10 governance note when null share > 40%.

### 3.4 Persist + seal (60 min)

- [ ] Writer: insert rows, compute `content_hash` over ordered rows, write `calibration_datasets`.
- [ ] `pnpm eval:make-dataset --label feedback|outcome` CLI.

### 3.5 Tests (75 min)

- [ ] Known-answer join on a seeded fixture (2 assessments, 1 with feedback).
- [ ] Null-handling: missing `was_useful` → row with `was_useful=null`, `label_source='outcome'`, counted in coverage (not dropped).
- [ ] Hash determinism: extract twice → same `content_hash`. Tamper one row → hash changes.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0106_calibration.sql` | Dataset + row tables |
| `packages/evaluation/src/calibration/extractor.ts` | Extraction + labeling + hash |
| `packages/evaluation/src/calibration/coverage.ts` | Coverage/balance report |
| `packages/evaluation/src/calibration/writer.ts` | Persist + seal |
| `packages/evaluation/src/__tests__/calibration.test.ts` | Known-answer + null + hash tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm eval:make-dataset --label feedback` over the live DB writes `calibration_datasets` + `calibration_rows` and prints `row_count` + null share.
- [ ] A seeded fixture with a known join produces exactly the expected rows (hand-computed labels asserted).
- [ ] `was_useful IS NULL` rows are retained with `label_source='outcome'` — `SELECT count(*) FROM calibration_rows WHERE was_useful IS NULL` matches the coverage report, not zero.
- [ ] `content_hash` is deterministic across two extractions of the unchanged store, and changes when one row's `outcome` is altered.
- [ ] Dataset records `source_version` and `label_source`.
- [ ] No `UPDATE`/`DELETE` path on `calibration_rows` (grep the writer) — append-only.
- [ ] `pnpm --filter @harness/evaluation test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Do not drop nulls, and do not impute them.** Both are forms of silent fabrication. A null share is a *finding* (reviewers aren't giving feedback, or decisions are missing the field) — surface it, don't paper over it.
- **`was_useful` and `outcome` are different signals and can disagree.** Treat disagreement as data: a reviewer says useful but the change defects later means the reviewer (or the prompt) is missing something. Never blend them into one label before you've looked at the disagreement rate.
- **Freeze the features at the factor level, not the raw signals.** The assessment's `factor_scores` were computed by the Phase-1 scoring path. If you reach behind them to raw file diffs, you've opened a second scoring pipeline that will drift from the deployed one — and the fit will tune a model that isn't what production runs.
- **The dataset is a point-in-time snapshot of a *live* pipeline.** As more decisions accumulate, extract a *new* dataset version rather than editing the old. Historical fits must map to a dataset, not "whatever the table contains now".
- **Beware of outcome leak in `DEFECTED_LATER`.** A defect that occurs *after* the dataset window looks like a clean approve inside the window. State the lag horizon in the dataset metadata (Day-06 pitfall, now on the fit set too).
- **Next (Day 12):** fit the Attention weights on a train/validation split and run the inflation monitor before/after.

---

*Prev: [Day 10 — Promote Spec 10 + Week 2 Metrics Checkpoint](day-10.md) | Next: [Day 12 — Weight Fitting: Attention Weights from Real Data](day-12.md)*
