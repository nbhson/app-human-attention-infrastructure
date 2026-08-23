# @harness/evaluation — Offline Pipeline-Quality Metrics & Replay

Scores the **pipeline**, not the change: routing precision/recall, attention
efficiency, and verification quality — plus trajectory replay and the A/B
machinery that compares two pipeline variants head-to-head.

**Status:** Phase 2 (Week 2) complete (as-built) ·
**Boundary rule:** offline/read-only — imports shared infrastructure + reads stores; never sits on the hot path.

---

## Purpose

1. **Compute metrics** over a windowed slice of recorded rows (`MetricsComputer`).
2. **Generate reports** append-only into a report history.
3. **Replay trajectories** faithfully, with zero production effect.
4. **Compare variants** head-to-head (the A/B harness).
5. **Fit weights** from real usefulness data (`calibration/weight-fitter`).

---

## Flow

```text
     loadMetricsInput (windowed store rows)
                │
                ▼
        metrics-computer.ts  (pure, offline)
                │
                ▼
        report-generator.ts → report-store.ts (append-only)
                │
                ├──────────────▶ applyGauges (Prometheus)
                └──────────────▶ scheduler.ts (nodeCron)
```

```text
     trajectory-replayer.ts ──(replay)──▶ ab-harness.ts ──(compare)──▶ AbOutcome
```

---

## A/B harness

A variant (e.g. a new ranker) only wins the default by winning a **measured
comparison**, never by being newer:

- `harness/ab-harness.ts` (`AbHarness`, `AbExperiment`) runs two pipeline
  variants side-by-side over the same corpus.
- `harness/compare.ts` (`compare`, `AbOutcome`) produces the head-to-head verdict
  (a `tau`-style rank correlation), subject to a guardrail before promotion.
- `harness/variant.ts` defines `PipelineVariant`, `RankCorpus`, and the
  keyword/dependency relevance primitives (`dependencyProximity`, `keywordOverlap`).

---

## Replay

`replay/hash.ts` (`hashSteps`, `stableStringify`) detects any divergence between
a replayed trajectory and the recorded one (`TrajectoryHashMismatchError`). This
is what makes the A/B shadow harness faithful: it re-materializes a recorded run
byte-for-byte, not approximately.

---

## Calibration

`calibration/weight-fitter.ts` + `extractor.ts` fit attention weights from
real review-usefulness data; `fit-report.ts` + `writer.ts` report and persist the
fit. A fitted vector only lands in `@harness/attention` if it beats the placeholder
(which, as of Week 6, it did not — the placeholder was kept).

---

## Modules

| Module | What it provides |
| --- | --- |
| `metrics-computer.ts` | `MetricsComputer` (pure) + `applyGauges`. |
| `loader.ts` | `loadMetricsInput`, `MetricsWindow`. |
| `labels.ts` | Ground-truth labelling. |
| `report.ts` / `report-generator.ts` | Report shape + `ReportGenerator` (`EmptyWindowError`). |
| `report-store.ts` | Append-only `ReportStore`. |
| `scheduler.ts` | `ReportScheduler` + `nodeCron`/`NOOP_CRON`. |
| `trajectory-replayer.ts` | `TrajectoryReplayer` (`ReplayInput`, `ReplayStep`, `ReplayResult`). |
| `replay/*` | loader, hash, stub-tool-executor, errors. |
| `harness/ab-harness.ts` | `AbHarness`, `AbExperiment`. |
| `harness/compare.ts` | `compare`, `AbOutcome`. |
| `harness/variant.ts` | `PipelineVariant`, `RankCorpus`, relevance primitives. |
| `ab/*` | ab-report, outcome-metrics, ranking-variants. |
| `calibration/*` | coverage, extractor, fit-report, weight-fitter, writer. |
| `cli.ts` / `report-cli.ts` / `replay-cli.ts` / `ab-cli.ts` / `fit-cli.ts` / `make-dataset-cli.ts` | The `pnpm eval:*` entrypoints. |

---

## Key invariants

- **Offline & windowed, append-only.** Metrics come from recorded rows into an
  append-only report history; a mistake is superseded by a new row, never an UPDATE.
- **Replay is faithful.** `hashSteps`/`stableStringify` catch divergence.
- **The A/B verifies this package's own claims.** A variant wins by measurement,
  not by recency. Closed-loop calibration (automatic feed-back) is out of scope here.
- **Read-only.** Nothing on the hot path blocks on evaluation.

---

## Directory structure

```
src/
├── index.ts
├── metrics-computer.ts / loader.ts / labels.ts
├── report.ts / report-generator.ts / report-store.ts / scheduler.ts
├── trajectory-replayer.ts
├── replay/          # errors, hash, loader, stub-tool-executor
├── harness/         # ab-harness, compare, variant
├── ab/              # ab-report, outcome-metrics, ranking-variants
├── calibration/     # coverage, extractor, fit-report, weight-fitter, writer
└── *-cli.ts         # cli, report-cli, replay-cli, ab-cli, fit-cli, make-dataset-cli
```

## Public API surface

```typescript
// MetricsComputer, applyGauges, loadMetricsInput, ReportGenerator, ReportStore,
// ReportScheduler, TrajectoryReplayer, AbHarness, compare/AbOutcome,
// PipelineVariant/RankCorpus + relevance primitives, calibration weight-fitter
```

## Wiring

CLIs are the `pnpm eval:*` scripts; the scheduler and report store are registered
in `apps/api/src/bootstrap.ts`.