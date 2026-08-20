# Day 39 — Benchmark Regression + Judge-Agreement Report

| | |
|---|---|
| **Week** | 8 — Harden, document, exit |
| **Spec refs** | Spec 11 §5.1–5.2 (benchmark + judge-as-authoritative-scorer + inter-judge agreement) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 38 (docs — specs v1.0 candidates, runbook + dev guide) |

---

## 1. Objectives

By end of day you will have:

1. A **benchmark regression run** — the frozen corpus re-run against the final-Phase-3 system, compared to the Day 30 baseline, so "did the phase actually change anything" is answered numerically.
2. A **judge-agreement report** — the final inter-judge + vs-human agreement numbers, recorded for the exit review as proof the scorer is credible.
3. **Regression gate**: no capability/label stratum regressed below the baseline without an explained, accepted reason; any unexplained regression blocks exit.
4. **Re-run reproducibility confirmed** on the final code (same corpus → same numbers within tolerance).

This is the phase's final measurement: the number the exit review (Day 40) will cite.

---

## 2. Design Decisions

### 2.1 Same frozen corpus, credible judge

Run Day 30's `bench-e2e.ts` against the **same** `corpus_version` and **same** rubric/judge configuration, except the system under test is now the hardened, closed-loop, documented Phase-3 build. Changing the corpus or judge at this point would make the comparison meaningless.

### 2.2 Baseline vs. final delta, per stratum

Report the delta (baseline → final) broken down by label stratum and by judge `total`, not just a single headline number. A headline that stays flat while `DEFECT_CAUGHT_LATER` recall collapsed is a regression wearing a disguise.

### 2.3 Regression policy

- A stratum that regresses below a configured tolerance (`REGRESSION_TOLERANCE`, default e.g. −5% relative on the key metric) requires a written explanation in the report.
- Unexplained regression → the exit review does not proceed; it's a shipped-defect signal, not a rounding error.

### 2.4 Judge-agreement finalization

Re-run Day 29's calibration on the final build; record `selfAgreement`, `cohensKappa` (vs human), `crossJudge`. The judge must clear Day 29's credibility thresholds to remain authoritative. If final agreement drifted below threshold, the judge is flagged and excluded — same rule as always.

### 2.5 Reproducibility as a gate

Two clean runs against the frozen corpus must agree within tolerance. Non-reproducibility is a *measurement failure* that blocks the exit review (you can't certify a number you can't reproduce).

---

## 3. Tasks

### 3.1 Final benchmark run (90 min)

- [ ] `pnpm run bench:e2e` (frozen corpus, credible judge) on the final build; capture full result set.

### 3.2 Baseline-vs-final delta (90 min)

- [ ] Compute per-stratum + overall deltas; flag regressions vs. tolerance (§2.3).

### 3.3 Judge-agreement finalization (60 min)

- [ ] Re-run calibration; record final agreement numbers; verify credibility thresholds.

### 3.4 Reproducibility check (60 min)

- [ ] Second clean run; assert within-tolerance agreement with the first.

### 3.5 Report (60 min)

- [ ] `docs/reports/phase3-benchmark-regression.md` — deltas, agreement, explanatory notes for any accepted regression.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `docs/reports/phase3-benchmark-regression.md` | Baseline→final delta + judge-agreement + reproducibility |
| `scripts/bench-e2e.ts` (unchanged, re-run) | Frozen-corpus run |
| `packages/judge/src/run-calibration.ts` (re-run) | Final agreement |

---

## 5. Acceptance Criteria

- [ ] Final benchmark runs on the **same frozen corpus + judge** as Day 30; full results captured.
- [ ] Baseline→final delta reported per stratum + overall.
- [ ] Any regression below tolerance has a written, accepted explanation; unexplained regression blocks exit.
- [ ] Final judge agreement (self + vs-human + cross) recorded and clearing Day 29 thresholds.
- [ ] Two clean runs agree within tolerance (reproducible).
- [ ] `docs/reports/phase3-benchmark-regression.md` exists.
- [ ] `pnpm lint` clean.

---

## 6. Notes & Pitfalls

- **Comparability is the whole point.** If you change the corpus or the judge on the last day, the "improvement" is an artifact of the ruler, not the system. Same corpus, same judge, same rubric — only the system changed.
- **Per-stratum, not just the headline.** A flat headline can hide a catastrophic `DEFECT_CAUGHT_LATER` recall drop. The 10% stratum exists precisely to catch that; report it explicitly.
- **An unexplained regression is a defect, not a footnote.** Logging "we got worse and don't know why" and proceeding is how a benchmark becomes theater. Explain it or stop.
- **Reproducibility is the report's own credibility.** Two runs that disagree mean the numbers aren't numbers. Diagnose before the exit review.
- **The judge agreement is a *final* check, not a repeat of Day 29's assumptions.** The hardened system may have changed latency/usefulness but should not have changed the judge's validity — confirm it hasn't.
- **Tomorrow (Day 40):** Phase-3 exit review — learning closed + demonstrable; tag release.

---

*Prev: [Day 38 — Docs: Specs to v1.0 Candidates, Runbook + Dev Guide](day-38.md) | Next: [Day 40 — Phase-3 Exit Review: Learning Closed + Demonstrable; Tag Release](day-40.md)*
