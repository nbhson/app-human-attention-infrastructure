# Phase 3 · Week 5 Retro — The review-quality loop closes, and holds

_Day-25 checkpoint (Phase 3). First pass over the LLM-as-judge (Day 21–22), the
judge-signal weight fit (Day 23), and the gold corpus (Day 24) — wired end-to-end
into one measurement that ends in an explicit **PROMOTE / HOLD** decision. Same
rule as every prior retro: numbers-first, blameless, and green before committed.
The headline this week is not an uplift; it is that the loop **measured → fit →
compared → decided**, and it decided to hold._

## What shipped this week

- **Day 21 — `@harness/judge`.** `Judge` scores a `ReviewReport` against a
  versioned rubric through the `LLMProvider` seam, stamps every run with a content
  hash + temperature, and records it via `JudgeRunStore` (append-only
  `judge_runs`).
- **Day 22 — inter-judge agreement.** `computeAgreement` folds N matched run pairs
  into per-dimension agreement (`1 − mean|a−b|`) + Cohen's κ on the `≥ 0.5` flag;
  `AgreementReport` persists one `judge_agreements` row carrying the very run ids
  it was computed from.
- **Day 23 — judge-signal fit.** `fitJudgeWeights` refits the five attention
  weights with the judge-disagreement signal in the confidence slot; the fit is
  gated by a before/after comparison **and** a `judgeSignalDominates` overfit
  alarm, folded into an `uplift`/`hold` `JudgeFitReport`.
- **Day 24 — `@harness/benchmark`.** A versioned store of gold-labelled review
  examples (`review_examples`), a read-only corpus loader, judge-vs-gold
  agreement (`computeGoldAgreement`), and a six-example redacted seed corpus.
- **Day 25 — the checkpoint itself.** `buildCalibrationReport` / `runCalibration`
  combine the three numbers into a PROMOTE/HOLD verdict with a per-gate reason
  trace; `pnpm calibration:report` runs the whole thing offline.

## The three numbers, one run (`pnpm calibration:report`)

The demo runs on the six-example seed corpus with a **deterministic
two-rater demonstration judge** (no live LLM, no API key — the real `Judge` needs
a `LLMProvider`, which this repo never carries by design). The agreement _math_
and the fit/A-B gate are the production code; only the LLM call is swapped, so the
pipeline shape is real while the score values are a model:

| Measurement                                   | Value (demo)                           | Floor               |
| --------------------------------------------- | -------------------------------------- | ------------------- |
| judge-vs-gold severity / routing / usefulness | 0.935 / 0.958 / 1.000 (`n=6`)          | usefulness ≥ 0.5    |
| inter-judge severity / routing (κ)            | 0.920 / 0.945 (κ 1.000, `n=6`)         | severity ≥ 0.7      |
| refit ranking (incumbent → candidate)         | 1.000 → 1.000 (log-loss 0.440 → 0.205) | candidate must lead |
| **A/B verdict**                               | **TIE** (`Δ = 0.0000`)                 | —                   |
| **Decision**                                  | **HOLD**                               | —                   |

## What the decision means — and why it is not a failure

The fit verdict was `UPLIFT` (the candidate beat the incumbent on held-out
_log-loss_, and the judge signal did **not** dominate a single column), but the
A/B gate scores on **ranking accuracy**, and there the two arms tied exactly
(`Δ = 0.0000`). The gate therefore refused to flip the default. That is the
discipline working, not a shortcoming: **§2.1 — "if the candidate doesn't beat
the incumbent, HOLD"** — a ranking tie earns a hold, and a `HOLD` with a clean
trace is the checkpoint done right.

Only when **all three** gates clear — (1) refit `uplift` without signal
dominance, (2) an A/B ranking **lead**, and (3) a trustworthy judge (usefulness
and inter-judge agreement above floor) — does the run emit `PROMOTE`. On this
seed the fit passes gate 1 and the judge passes gate 3, but gate 2 is a tie, so
the verdict is HOLD. The default weight set was **not** flipped.

## The honesty boundary (what the demo does _not_ prove)

- **The judge is a stand-in.** The demonstration scorer perturbs the gold, so the
  near-1.0 agreements are circular, not evidence. Real agreement needs a live
  judge over independent reports.
- **Factor scores are mapped from the rubric.** The refit consumes
  `[risk, impact, novelty, complexity, confidence]`, but the corpus stores only
  `{severity, routing, useful}`. The demo derives factors from the gold; the
  production path reads them from the Attention Engine's assessment of the PR.
- **`n=6` is not a signal yet.** The fit is run to exercise the gate, not to
  produce deployable weights; Day 39 is the regression that demands a larger,
  independently-labelled corpus.

## The invariants, and what holds them

- **The boundary still holds.** `@harness/evaluation` imports only domain types +
  its own fitter when combining the numbers — it never reaches into `@harness/judge`
  or `@harness/benchmark`. The cross-package compositor is the app host (`apps/api`
  imports anything), verified by the boundary linter and `architecture.test.ts`
  (R17 pins `benchmark → domain/db/judge`; R9 pins `evaluation → domain/db/di/
observability`).
- **Every number recomputes from audit rows.** `computeAgreement` (judge) and
  `computeGoldAgreement` (benchmark) are pure functions over score/run objects;
  `runCalibration` recomputes the refit from the judge-augmented samples. Nothing
  is asserted — only measured — and each is unit-tested in isolation.
- **No live keys, no sandbox escape.** The real Anthropic path is compile-tested
  only; `.env.example` carries a placeholder; the demo runs keyless.

## Acceptance criteria

- [x] `pnpm calibration:report` runs corpus → judge → agreement → refit → A/B → report end-to-end.
- [x] Inter-judge and judge-vs-gold agreement are printed with provenance (seed ids + raters + `n`).
- [x] The A/B harness emits a definitive PROMOTE/HOLD verdict (HOLD here, on a ranking tie).
- [x] Every number recomputes from its inputs (pure functions, unit-tested).
- [x] `pnpm test` (695+) and `pnpm lint` green.

---

_Next: Day 26 — Hybrid Retriever Default: BM25 + Embeddings Fused_
