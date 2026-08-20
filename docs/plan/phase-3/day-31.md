# Day 31 — Learning Pipeline: Evaluation Results → Calibration Update (Automated)

| | |
|---|---|
| **Week** | 7 — Close the loop, deploy observed |
| **Spec refs** | Spec 11 §5.3 (learning loop: evaluate → calibrate → deploy), Spec 11 §5.2 (scores from real pipeline) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 30 (Week 6 checkpoint — benchmark + judge baseline) |

---

## 1. Objectives

By end of day you will have:

1. A **learning pipeline** in a new `packages/learning` (`@harness/learning`) package that ingests **evaluation results** (benchmark verdicts + production usefulness signals) and emits **calibration updates** — automated, but gated and audited.
2. **Calibration update model**: what changed, from what evidence, with what anticipated effect — never a silent mutation of thresholds/weights.
3. **Gate the update**: no calibration change is applied automatically to production; it is *prepared*, then released through the existing A/B/shadow deployment seam.
4. **Evidence provenance**: every calibration update links back to the runs/verdicts/decisions that justified it (Spec 11 §5.2: scores measured through the real pipeline).

This is the first leg of the closed loop — Evaluate → Calibrate. It must be traceable and conservative, because it closes a loop that could otherwise reinforce its own errors.

---

## 2. Design Decisions

### 2.1 `learning/` package boundary

`@harness/learning` imports `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`. It consumes evaluation *events/records*; it does **not** import engines to mutate them in-process — updates are published as a calibration artifact consumed through the same DI/deploy seam as any config change.

### 2.2 Calibration update model

```typescript
// packages/learning/src/calibration.ts
export interface CalibrationUpdate {
  id: string;
  target: 'ranking_weights' | 'confidence_threshold' | 'retention_policy' | 'judge_rubric' | ...;
  before: Record<string, unknown>;       // current value
  after: Record<string, unknown>;        // proposed value
  evidence: EvidenceRef[];               // runs/verdicts/decisions that justify it
  method: 'grid_search' | 'bayesian' | 'gradient' | 'manual';
  pValue?: number;                       // statistical confidence of the improvement
  effectSize?: number;                   // measured delta on the frozen corpus
  status: 'PREPARED' | 'SHADOWING' | 'APPROVED' | 'APPLIED' | 'REJECTED';
  createdAt: Date;
}
```

`before`/`after` are explicit diffs — no update is a mystery mutator.

### 2.3 Statistical discipline (don't tune on noise)

An update is only `PREPARED` when supported by an **effect**: a benchmark delta on the frozen corpus (or a production usefulness lift) with a recorded `pValue`/`effectSize`, and a minimum sample size `MIN_SAMPLES`. Below it → `REJECTED` with reason "insufficient evidence".

### 2.4 Conservative search (spec-lean)

The optimizer searches a small bounded parameter space (grid/hill-climb), never a neural net over the whole config. The update targets *one* threshold/weight set at a time, so its effect is attributable and reversible.

### 2.5 Close-the-loop plumbing

Emit `calibration.update_prepared { updateId, target, before, after, effectSize }`; the **deploy** leg (shadow/A/B) consumes `calibration.update_prepared` and moves status → `SHADOWING` → `APPROVED`/`APPLIED` per the existing rollout gate (Day 19's A/B harness, re-used). **Nothing auto-applies to production.**

---

## 3. Tasks

### 3.1 Scaffold `packages/learning` (30 min)

- [ ] `package.json`, `tsconfig.json`, barrel; boundary config.

### 3.2 Evaluation-result ingestion (120 min)

- [ ] `EvaluationResultIngestor` — consumes benchmark verdicts + production usefulness signals into a normalized `evaluation_results` table.
- [ ] Dedup: same run/verdict ingested twice ≠ two samples.

### 3.3 Calibration-update model + schema (90 min)

- [ ] `CalibrationUpdate` (§2.2), `calibration_updates` table + migration.

### 3.4 Updater + statistical gates (150 min)

- [ ] `prepareUpdate(target, evidence)` — bounded search, `before`/`after`, `pValue`/`effectSize`, `MIN_SAMPLES` gate (§2.3–2.4).
- [ ] Tests: sufficient evidence → `PREPARED`; insufficient → `REJECTED`; update is reversible/attributable.

### 3.5 Event + status plumbing (90 min)

- [ ] Emit `calibration.update_prepared`; wire `status` transitions to the A/B rollout gate (never auto-`APPLIED`).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/learning/package.json` + `tsconfig.json` + barrel | New package |
| `packages/learning/src/calibration.ts` | `CalibrationUpdate` |
| `packages/learning/src/ingest.ts` | `EvaluationResultIngestor` |
| `packages/learning/src/updater.ts` | `prepareUpdate` + statistical gates |
| `packages/db/src/schema/learning.ts` + migration | `evaluation_results`, `calibration_updates` |
| `packages/learning/src/__tests__/updater.test.ts` | Gate + reversibility tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/learning test` — all tests pass.
- [ ] Evaluation results (benchmark + production usefulness) normalized into `evaluation_results` (dedup enforced).
- [ ] Every `CalibrationUpdate` has `before`/`after`/`evidence`/`status`; targeting one parameter set at a time.
- [ ] Updates below `MIN_SAMPLES` or without a measured effect are `REJECTED` (no tuning on noise).
- [ ] No update auto-applies to production; `PREPARED → SHADOWING → APPROVED/APPLIED` only through the existing rollout gate.
- [ ] `calibration.update_prepared` emitted; updates reversible.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **A closed loop can reinforce error.** Evaluate → Calibrate that tunes on its own noisy scores without a statistical gate is a feedback loop that entrenches bias, not reduces it. The `MIN_SAMPLES` + `effectSize` + `pValue` gates are the difference between "learning" and "drift."
- **`before`/`after` are non-optional.** A calibration update that can't be diffed can't be reviewed or reverted. No silent mutators.
- **One target at a time.** Tuning five knobs at once makes attribution and rollback impossible. Target one weight/threshold per update.
- **Prepare ≠ deploy.** Day 31 only *prepares* updates. Applying them rides the existing shadow/A/B seam. The loop "runs continuously" only because the deploy leg is gated, not because it self-applies.
- **Evidence must cite real runs.** A calibration update without provenance is a hand-waved magic-number change. Link `EvidenceRef` to actual verdicts/decisions.
- **Tomorrow (Day 32):** feedback into context ranking — learn ranking params from usefulness.

---

*Prev: [Day 30 — Week 6 Checkpoint: Benchmark + Judge Run End-to-End on Corpus](day-30.md) | Next: [Day 32 — Feedback Into Context Ranking: Learn Ranking Parameters From Usefulness](day-32.md)*
