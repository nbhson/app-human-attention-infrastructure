# Phase 3 · Benchmark Retro — regression PASS, agreement recomputed from the audit rows

*Day-39 checkpoint (Phase 3). The "measure-the-measurer" day: re-run the
review-quality corpus against the current system, diff every number against the
recorded Day-25 baseline, and recompute inter-judge + judge-vs-gold agreement
from the __audit rows__, not from the in-memory objects that originally produced
them. Same rule as every prior retro: numbers-first, blameless, and green before
committed. The headline is deliberately unexciting — **no regression** — because
the point of a regression harness is that a clean run is the pass, not a headline
(days 39 §2.1, §6).*

## What shipped today (Day 39)

- **`scripts/benchmark-regression.ts`** (`pnpm benchmark:regression`) — re-runs
  the versioned seed corpus (`scale v1`) through judge → agreement → refit → A/B,
  then diffs every measured number against the Day-25 baseline and emits a
  **PASS / WARN / FAIL per metric** with its explicit tolerance. Offline and
  keyless: the judge is the deterministic two-rater demonstration scorer, so the
  run is byte-reproducible.
- **`scripts/judge-agreement-report.ts`** (`pnpm judge:agreement-report`) — the
  provenance half. It persists the demo judges' runs through the *real*
  `judge_runs` / `judge_agreements` stores (an isolated Postgres schema), then
  **reads them back** and recomputes the agreement from the stored rows, proving
  the numbers are reproducible from the audit trail. Hermetic: the schema is
  `DROP SCHEMA … CASCADE`'d on exit.
- **`docs/retros/phase3-benchmark.md`** — this retro: the regression verdicts,
  the recompute proof, and the honesty boundary.

## The regression diff (baseline → current)

The baseline is the Day-25 Week-5 checkpoint (recorded at 3 decimals in
`phase3-w5.md`); "current" is today's re-run of the *same* corpus and the *same*
seeded scorer. Every metric reproduces within float-display rounding, so every
verdict is **PASS**:

| Metric | Baseline | Current | Δ | Verdict |
|---|---|---|---|---|
| judge-vs-gold severity | 0.935 | 0.935 | +0.0002 | PASS (±0.03) |
| judge-vs-gold routing | 0.958 | 0.958 | +0.0003 | PASS (±0.03) |
| judge-vs-gold usefulness | 1.000 | 1.000 | ±0.0000 | PASS (floor 0.5) |
| inter-judge severity agreement | 0.920 | 0.920 | +0.0001 | PASS (floor 0.7) |
| inter-judge routing agreement | 0.945 | 0.945 | −0.0002 | PASS (±0.03) |
| inter-judge κ (severity) | 1.000 | 1.000 | ±0.0000 | PASS |
| refit ranking (incumbent → candidate) | 1.000 → 1.000 | 1.000 → 1.000 | — | PASS |
| refit log-loss (incumbent → candidate) | 0.440 → 0.205 | 0.440 → 0.205 | — | PASS |
| A/B verdict | TIE (Δ 0.0000) | TIE (Δ 0.0000) | — | PASS |
| decision | HOLD | HOLD | unchanged | PASS |

**Overall: PASS (10 pass / 0 warn / 0 fail).** The micro-Δs (`+0.0002`,
`−0.0002`, …) are *display* rounding: the baseline was scribed at 3 decimals and
the re-run carries full float precision — not drift. A tolerance of ±0.03 (WARN
≤ ±0.05) makes that explicit rather than buried.

## The recompute proof (agreement from the audit rows)

`pnpm judge:agreement-report` writes 12 `judge_runs` rows (6 reports × 2 raters)
and one `judge_agreements` row, then re-derives the same two numbers *from those
rows*:

- **inter-judge** severity 0.920 / routing 0.945 (κ 1.000, `n=6`) — recomputed
  phrase-by-phrase from the read-back `judge_runs` score columns, paired by
  `report_id` (rater-a ↔ rater-b on the same report), and asserted **equal to the
  persisted `judge_agreements` row within 1e-9**.
- **judge-vs-gold** severity 0.935 / routing 0.958 / usefulness 1.000 (`n=6`) —
  recomputed by joining the read-back rater-a runs to the corpus gold by
  `report_id`. Gold lives in the corpus, never in `judge_runs` — gold is a human
  label, not judge output (day-24 §6).

Every run is stamped with its canonical `report_hash` (sha-256 of the judged
artifact) and a UUIDv7 run id; the persisted `judge_agreements` row carries the
very `run_a_ids` / `run_b_ids` / `report_hashes` it was computed from. That is
the "numbers reproducible from stored rows" acceptance criterion made literal:
a screenshot is not an audit (day-39 §2.2).

## The honesty boundary (what today does *not* prove)

- **The regression proves the *pipeline math* is regression-free, not that the
  judge is good.** The only LLM call is a seeded PRNG stand-in (`mulberry32`,
  seeds 1 & 2) that perturbs the gold — so the near-1.0 agreements are circular,
  and the Δ=0.000 regression is *by construction*. It catches a drift in the
  agreement/refit/A-B `compute` path; it cannot catch live-model drift, which
  needs a keyed corpus × live-judge run this repo deliberately never carries
  (compile-tested-only `.env` hygiene).
- **`n=6` is a mechanism test, not a signal.** The corpus exercises the gate; a
  larger, independently-labelled corpus is the precondition for deployable
  weights (carried from day-25 §6).
- **No code-generation content anywhere.** The corpus is review-quality gold
  labels; the regression asserts *review* quality only (day-39 §2.4).

## Acceptance criteria

- [x] Corpus regression runs against the current system and emits a PASS/WARN/FAIL per metric — 10/10 PASS.
- [x] Inter-judge + judge-vs-gold agreement recomputed from audit rows with provenance (run ids + report hashes + `n`).
- [x] No quality regression beyond tolerance (Δ within float-display rounding).
- [x] Numbers reproducible from stored rows — persisted `judge_agreements` row ≡ recompute from `judge_runs` (within 1e-9).
- [x] No code-generation benchmark content anywhere.

---

*Next: Day 40 — Phase-3 Exit Review: Learning Closed + Demonstrable; Tag Release*