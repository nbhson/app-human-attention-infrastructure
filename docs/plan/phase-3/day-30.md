# Day 30 — Week 6 Checkpoint: Benchmark + Judge Run End-to-End on Corpus

| | |
|---|---|
| **Week** | 6 — Benchmark + judge |
| **Spec refs** | Spec 11 §5 (benchmark corpus, MBH, LLM-as-judge), Architecture §4.2 |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 29 (judge calibration + inter-judge agreement) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. No new features. By end of day you will have:

1. A **single end-to-end run**: frozen corpus → MBH → real pipeline → `BenchRun` → gold-test adjudication → judge verdict → calibration/agreement — all venting from one command, with a report.
2. **A baseline score** for the Phase-3 system on the frozen corpus (this is the number every later "improvement" must beat).
3. **A credibility check** on the judge before its output is admitted downstream.
4. A **Week 6 retrospective note**.

**Do not proceed to Day 31 until every acceptance criterion in §5 is green** — Week 7 feeds evaluation results into calibration, and an un-credible judge would poison that loop.

---

## 2. What Week 6 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| Benchmark corpus — frozen gold labels (SWE-bench-style) | `@harness/benchmark` | ✅ Day 26 |
| Benchmark runtime — MBH container (bash + editor) | `@harness/benchmark` | ✅ Day 27 |
| LLM-as-judge — rubric-scored, `LLMProvider`-mediated, audited | `@harness/judge` | ✅ Day 28 |
| Judge calibration + inter-judge agreement + audit | `@harness/judge` | ✅ Day 29 |

---

## 3. Tasks

### 3.1 End-to-end runner (120 min)

- [ ] `scripts/bench-e2e.ts`: corpus `v1` → for each task: MBH run → gold-test adjudication → judge verdict → aggregate.
- [ ] Deterministic ordering + a fixed seed; run twice to confirm reproducibility.

### 3.2 Baseline report (90 min)

- [ ] Aggregate `passed` rate by `label` stratum and judge `total` distribution; write `docs/reports/phase3-baseline.md`.
- [ ] Record the **baseline** — this is the reference number for all of Week 7/8.

### 3.3 Credibility check before admission (60 min)

- [ ] Assert the judge is credible (self-agreement + vs-human agreement reach the Day 29 thresholds) **before** any score is recorded as authoritative.
- [ ] A non-credible judge halts the checkpoint (scores recorded but flagged, closed loop not fed).

### 3.4 Week 6 retro (60 min)

File: `docs/retros/week-06-phase3.md` (`# Week 6 Phase 3 Retro — Benchmark + judge`), standard sections.

Prompts: Is the corpus representative or quietly skewed? Does the judge pass the sniff test on a few known-good/known-bad runs? Did any run leak `goldPatch` or auto-advance a `HUMAN_ROUTED` task? Is the MBH minimal enough?

### 3.5 Update wiring map + README (30 min)

- [ ] `docs/architecture/wiring-map.md` — benchmark + judge + calibration.
- [ ] `README.md` — "Phase 3 Week 6 Status" note + baseline number.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/bench-e2e.ts` | One-command E2E benchmark run |
| `docs/reports/phase3-baseline.md` | Baseline score + breakdown |
| `docs/retros/week-06-phase3.md` | Retrospective |
| `README.md` (updated) | Week 6 status + baseline |

---

## 5. Acceptance Criteria

- [ ] One command runs frozen corpus → MBH → pipeline → adjudication → judge → report, end-to-end.
- [ ] `passed` adjudication is mechanical (gold tests); judge never overrides it.
- [ ] Judge credibility confirmed (self + vs-human agreement ≥ thresholds) before scores are treated as authoritative.
- [ ] Baseline recorded, broken down by `label` stratum.
- [ ] Re-run is reproducible (same tasks, comparable results); no `goldPatch` leak; no `HUMAN_ROUTED` auto-advance.
- [ ] `docs/reports/phase3-baseline.md` + `docs/retros/week-06-phase3.md` exist.
- [ ] `pnpm lint` clean across all touched packages.

**Checkpoint rule:** If the judge is not credible, or the baseline is non-reproducible, stop. Week 7's closed loop consumes exactly these numbers; garbage here is guaranteed garbage in the learning pipeline.

---

## 6. Notes & Pitfalls

- **This checkpoint produces the reference number.** "Better" in Weeks 7–8 means "above this baseline on the *same frozen corpus*, credible judge." Anything that moves the number without a credible scorer or a frozen corpus is a measurement artifact, not progress.
- **The judge runs last, and never upstream of correctness.** gold-test `passed` is adjudicated before and independently of the judge. A judge that could flip `passed` would be the loop self-grading.
- **No "trivial" corpus wins.** If the baseline is suspiciously high, suspect the corpus composition (Day 26) — an all-easy corpus inflates the baseline and hides every later regression. Re-check the stratum mix before trusting a rosy number.
- **Reproducibility is the checkpoint's own credibility.** If `bench-e2e.ts` gives different numbers across two clean runs, the downstream A/B and calibration are measuring noise. Diagnose determinism today.
- **Do not start Week 7's calibration today.** The closed loop must not open until the judge + baseline are proven credible and frozen.
- **Tomorrow (Day 31):** learning pipeline — evaluation results → calibration update (automated).

---

*Prev: [Day 29 — Judge Calibration + Inter-Judge Agreement + Audit Trail](day-29.md) | Next: [Day 31 — Learning Pipeline: Evaluation Results → Calibration Update (Automated)](day-31.md)*
