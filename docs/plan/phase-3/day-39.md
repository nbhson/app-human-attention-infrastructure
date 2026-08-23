# Day 39 — Benchmark Regression + Judge-agreement Report

| | |
|---|---|
| **Week** | 8 — Harden + exit |
| **Spec refs** | Spec 11 §5.1 (judge benchmark); Phase-3 README §7 (judge exit); Day 24 corpus + Day 22 agreement |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 24 (gold corpus), 22/25 (agreement), all subsystems built; Day 38 docs apply |

---

## 1. Objectives

By end of day you will have:

1. A **benchmark regression** run — the review-quality corpus (Day 24) executed against the current system to confirm no quality regression vs the last recorded baseline (judge-vs-gold agreement, routing/severity agreement).
2. A **judge-agreement report** recomputing inter-judge agreement + judge-vs-gold agreement from the audit rows, with full provenance.
3. A regression delta: current numbers vs prior checkpoint, flagging any drift for the Day 40 exit review.
4. Results recorded for the exit-review evidence pack.

This is the *measure-the-measurer* day — the benchmark proves the review-quality machinery still holds before we call the phase done.

---

## 2. Design Decisions

### 2.1 Regression = corpus re-run, baseline compare

Run the same versioned corpus (same `scale_version`) through judge + agreement + weight-fit; diff against the last recorded numbers. A drift (worse agreement, worse fit uplift) is a **regression to investigate**, not a number to bury.

### 2.2 Reproducibility is the standing bar

Every figure in the report recomputes from stored rows (report hashes, `judge_runs`, `judge_agreement`), so the Day 40 reviewer can re-run and get the same numbers.

### 2.3 Report is decision-ready

The report ends with a clear verdict per metric: PASS (within tolerance), WARN (drift within-bound), FAIL (regression beyond tolerance) — so the exit review gets a red/yellow/green, not a spreadsheet.

### 2.4 No code-generation benchmark content

The corpus is review-quality gold labels only; the regression asserts *review* quality, never code-synthesis — matching the review-reorient.

---

## 3. Tasks

### 3.1 Baseline snapshot (30 min)

- [ ] Record the current baseline (Day 25/W5 numbers) as the comparison target.

### 3.2 Regression run (90 min)

- [ ] Execute corpus → judge → agreement → fit; capture current numbers.

### 3.3 Delta + thresholds (60 min)

- [ ] Diff vs baseline; apply PASS/WARN/FAIL tolerances.

### 3.4 Judge-agreement report (60 min)

- [ ] Recompute inter-judge + judge-vs-gold agreement from audit rows; provenance included.

### 3.5 Evidence pack (30 min)

- [ ] `docs/retros/phase3-benchmark.md` — numbers + verdicts.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/benchmark-regression.ts` (or `eval:*`) | Corpus regression runner |
| `scripts/judge-agreement-report.ts` | Agreement recompute + report |
| `docs/retros/phase3-benchmark.md` | Regression + agreement evidence |

---

## 5. Acceptance Criteria

- [ ] Corpus regression runs against the current system and emits a PASS/WARN/FAIL per metric.
- [ ] Inter-judge + judge-vs-gold agreement recomputed from audit rows with provenance.
- [ ] No quality regression beyond tolerance (or a documented WARN/FAIL with cause).
- [ ] Numbers reproducible from stored rows.
- [ ] No code-generation benchmark content anywhere.

---

## 6. Notes & Pitfalls

- **A regression is a finding, not a failure of the day.** The correct output of a regression harness is sometimes "FAIL — investigate"; surfacing it is exactly the job.
- **Same corpus version, or the diff is meaningless.** Comparing across `scale_version` changes mixes rubric drift with quality drift; pin the version.
- **Provenance or it didn't happen.** A headline number without the run ids is un-auditable for the exit review.
- **Day 40:** Phase-3 exit review — Learning closed + demonstrable; tag release.

---

*Next: [Day 40 — Phase-3 Exit Review: Learning Closed + Demonstrable; Tag Release](day-40.md)*