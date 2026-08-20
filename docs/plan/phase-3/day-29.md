# Day 29 — Judge Calibration + Inter-Judge Agreement + Audit Trail

| | |
|---|---|
| **Week** | 6 — Benchmark + judge |
| **Spec refs** | Spec 11 §5.1 (LLM-as-judge calibration, inter-judge agreement) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 28 (LLM-as-judge rubric-scored, audited) |

---

## 1. Objectives

By end of day you will have:

1. **Judge calibration**: the judge's rubric scores are compared against human gold labels/annotations, producing agreement metrics (not trust-by-assertion).
2. **Inter-judge agreement** (per-vendor/model + duplicate-run reproducibility): same run scored twice → same verdict; two judges on the same run → measurable agreement (Cohen's kappa / correlation).
3. A **complete audit trail** tying every verdict to its model, rubric version, prompt hash, and agreement measurements — so "the judge says X" is evidence-backed.
4. **Calibration thresholds**: a judge whose agreement falls below the bar is flagged non-credible; its scores are not admitted into calibration (Day 31).

This answers the judge's own trust question before the closed loop (Week 7) is allowed to consume its output.

---

## 2. Design Decisions

### 2.1 Agreement metrics

```typescript
// packages/judge/src/calibration.ts
export interface JudgeAgreement {
  judgeModel: string;
  rubricVersion: string;
  n: number;                    // paired runs scored
  cohensKappa: number;          // categorical agreement (ordinal buckets) vs human
  spearman: number;             // rank-order correlation vs human
  selfAgreement: number;        // identical run scored twice, same judge → must be ~1.0
  crossJudge: number;           // judge A vs judge B on same run
  calibratedAt: Date;
}
```

- **Self-agreement** (deterministic reproducibility): the same judge, same run, twice → near-1.0. Low self-agreement means non-determinism/leakage, and disqualifies the judge regardless of human agreement.
- **Cross-judge + vs-human** measure *validity*: does the judge agree with the thing that is actually correct (human gold), not just with a second LLM that learned the same bias.

### 2.2 Calibration set

Calibration uses a **held-out slice** of the corpus whose tasks have been human-annotated (beyond the mechanical gold tests). A judge is calibrated on this slice; agreement numbers are recorded; the same slice is re-used each calibration run so numbers are comparable.

### 2.3 Credibility gate

A judge is "credible" when: `selfAgreement ≥ 0.95` **and** `cohensKappa ≥ MIN_KAPPA` (default 0.6) **and** `spearman ≥ MIN_SPEARMAN` (default 0.7). Below the bar → verdicts flagged `credible: false` and excluded from downstream calibration. The gate is a *number*, not a human hunch, so it can be CI-checked.

### 2.4 Audit trail extension

`judge_agreement` records (append-only) + `judge_audit` rows for any calibration event. The audit trail now answers, per verdict: what model, what rubric version, what prompt hash, what agreement numbers backed the judge's credibility at scoring time.

### 2.5 Multi-judge support (seam, not sprawl)

The judge interface is model-agnostic (`LLMProvider`). "Two judges" == two `LLMProvider` configuration entries (e.g. vendor A model X, vendor B model Y). No bespoke per-vendor code — cross-judge is a config difference, not a new subsystem.

---

## 3. Tasks

### 3.1 Calibration set + human annotations (120 min)

- [ ] Select + annotate a held-out corpus slice (≥15 tasks); store `bench_annotations` (human rubric scores).
- [ ] Freeze the calibration slice version so repeated runs compare like-for-like.

### 3.2 Agreement metrics (`calibration.ts`) (120 min)

- [ ] Compute `cohensKappa`, `spearman`, `selfAgreement`, `crossJudge` (§2.1).
- [ ] Tests: known distribution → expected values; edge cases (constant scores, n<2).

### 3.3 Calibration runner (90 min)

- [ ] `runCalibration(judgeConfig)` — score the slice, compute agreement, persist `judge_agreement` + audit rows.
- [ ] Deterministic self-agreement run (scored twice, assert near-1.0).

### 3.4 Credibility gate (90 min)

- [ ] `isCredible(agreement, thresholds)`; flag `credible: false` below bar (§2.3).
- [ ] Tests: below-bar agreement → non-credible; `selfAgreement < 0.95` disqualifies even with high human agreement.

### 3.5 Audit + report (90 min)

- [ ] `scripts/calibrate-judge.ts` emits a Markdown report (agreement table, credibility, thresholds).
- [ ] Wire `judge_agreement` into the audit trail (append-only, immutable).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/judge/src/calibration.ts` | Agreement metrics + credibility gate |
| `packages/db/src/schema/judge.ts` (updated) | `bench_annotations`, `judge_agreement` |
| `packages/judge/src/run-calibration.ts` | Calibration runner |
| `scripts/calibrate-judge.ts` | CLI report |
| `packages/judge/src/__tests__/calibration.test.ts` | Metric + gate tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/judge test` — all tests pass.
- [ ] `selfAgreement` ≈ 1.0 on a deterministic re-scored run; below 0.95 disqualifies.
- [ ] `cohensKappa` + `spearman` computed against human annotations on the calibration slice.
- [ ] `isCredible` gates below the configured thresholds; below-bar verdicts are flagged `credible: false`.
- [ ] Cross-judge agreement measured for ≥2 `LLMProvider` configs on the same runs.
- [ ] Agreement + audit records are append-only; calibration slice is frozen.
- [ ] `scripts/calibrate-judge.ts` produces a human-readable report.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **Self-agreement first, validity second.** A judge that doesn't agree with *itself* on the same run can't possibly be valid; agreement with a human is meaningless noise if the judge is non-deterministic. Check reproducibility before asserting accuracy.
- **Cross-judge ≠ validity.** Two LLM judges agreeing only proves they share a bias. Agreement *against human gold* is the validity signal; cross-judge is a diagnostic, not a substitute.
- **A credibility gate is a number, not a vibe.** If you can't state `cohensKappa ≥ X`, you can't gate on it. Pick thresholds, put them in config, CI-check them.
- **Freeze the calibration slice.** Re-annotating or re-slicing between runs silently changes what "agreement" means. Version it like the corpus.
- **Below-bar judges must not flow downstream.** A non-credible judge's scores entering Week 7's calibration would poison the closed loop with a biased signal — the exact failure the harness exists to prevent. Flag and exclude.
- **Tomorrow (Day 30):** Week 6 checkpoint — benchmark + judge run end-to-end on the corpus.

---

*Prev: [Day 28 — LLM-as-Judge: Rubric-Scored Behind `LLMProvider`, Audited](day-28.md) | Next: [Day 30 — Week 6 Checkpoint: Benchmark + Judge Run End-to-End on Corpus](day-30.md)*
