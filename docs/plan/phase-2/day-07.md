# Day 07 — Report Generator: Scheduled Metrics & Trends

| | |
|---|---|
| **Week** | 2 — Evaluation v0 + Spec 10 |
| **Spec refs** | Spec 11 §4 (metrics), §5 (reports gate rollouts); Phase-1 day-27 audit cookbook (Q3–Q6 migration to trends) |
| **Estimated effort** | 6 hours |
| **Prerequisites** | Day 06 (`MetricsComputer` + `pnpm eval:metrics`) |

---

## 1. Objectives

By end of day you will have:

1. A **`ReportGenerator`** in `@harness/evaluation` that assembles a windowed `MetricsReport` into a human-readable summary: current numbers, deltas vs the prior window, and trend direction.
2. A **scheduled job** (`pnpm eval:report --schedule`) that writes reports on a cron and appends each to a **report history** (Postgres table), so "what were the numbers last week?" is a query, not a memory.
3. **Trend detection** — a flag on each metric when it crosses a simple threshold (e.g. precision dropping, inflation rising) — so the report says *what changed*, not just *what is*.
4. A **self-validating report** — the generator refuses to emit a report for an empty/windowless input (the Day-06 empty-window guarantee, now enforced at the product boundary).

The numbers exist as of yesterday; without this day they are a CLI printout. A report is how a metric becomes a *decision input* — Week 3's calibration gates on the before/after *report*, not on a number somebody remembers.

---

## 2. Design Decisions

### 2.1 Report shape — current value, delta, trend, guardrail

```typescript
// packages/evaluation/src/report.ts
export interface MetricLine {
  key:          string;            // e.g. "routing.precision"
  value:        number | undefined;// current window value (undefined = hole)
  previousValue: number | undefined;
  delta:        number | undefined;// value - previousValue
  trend:        'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';
  guardrail?:   string;            // human string when a threshold is crossed
}

export interface MetricsReport {
  window:       { from: string; to: string };
  generatedAt:  string;
  lines:        MetricLine[];
}
```

Trend is **delta-derived, not model-derived**: `value` vs `previousValue` over a fixed window length. A "trend" that requires a stat library is a Phase-3 nicety; a delta vs the prior period is enough to run a calibration gate.

### 2.2 Guardrail thresholds (v0 — loud, reversible)

| Metric | Direction | Threshold | Guardrail message |
|--------|-----------|-----------|-------------------|
| `routing.precision` | DOWN | < 0.70 | "Precision below 0.70 — review the routing thresholds" |
| `routing.recall` | DOWN | < 0.60 | "Recall below 0.60 — auto-approvable set is leaking defects" |
| `attention.inflationRatio` | UP | CRITICAL+HIGH > 0.30 | "Inflation alert — Spec 6 §4.1 ceiling crossed" |
| `efficiency.humanMinutesPerAccept` | UP | +50% week-over-week | "Human cost per accept rising sharply" |

These mirror Spec 6 §4.1's inflation ceiling and the A/B gate ("beat the incumbent") that Day 09 makes explicit. Thresholds live in a constants file, not inline — Day 13 tunes them from real data.

### 2.3 Report persistence — append-only `evaluation_reports`

```sql
-- packages/db/migrations/0104_eval_reports.sql
CREATE TABLE evaluation_reports (
  id          text PRIMARY KEY,               -- UUIDv7
  window_from timestamptz NOT NULL,
  window_to   timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  report      jsonb NOT NULL,                 -- full MetricsReport
  source_version text NOT NULL                -- "v0.2.0-harness" / commit sha that produced it
);
CREATE INDEX evaluation_reports_window_idx ON evaluation_reports(window_from, window_to);
```

Reports are **append-only** (never UPDATE a published report — same rule as evidence). `source_version` is required so a trend comparison is attributed to code, not drift.

### 2.4 Scheduling — in-process cron, not a new service

The modular monolith still runs on one process. Use `node-cron` inside the API for the scheduled edge (`EVAL_REPORT_SCHEDULE` env, e.g. `0 6 * * 1` = Monday 06:00), with a `--once` mode for the CLI and tests. No sidecar, no durable queue — a missed cron tick is logged, not a lost fact (reports can be backfilled via `--from/--to`.

---

## 3. Tasks

### 3.1 Report shape + generator (75 min)

- [ ] `packages/evaluation/src/report.ts` — `MetricLine`/`MetricsReport` (§2.1).
- [ ] `packages/evaluation/src/report-generator.ts` — `generate(current, previous)`: compute deltas, trends, guardrails.
- [ ] Refuse to generate on an empty window (throw `EmptyWindowError` with a clear message).

### 3.2 Persistence + migration (60 min)

- [ ] Migration `0104_eval_reports.sql` (§2.3); add a `ReportStore` (insert + `listByWindow`) in `@harness/evaluation`.
- [ ] Guarantee append-only: repository exposes `insert`/`query`, **no** `update`/`delete` methods (enforced by API shape, like the evidence store).

### 3.3 Scheduler + CLI (60 min)

- [ ] `packages/evaluation/src/scheduler.ts` — `node-cron` edge; `--once`/`--schedule`/`--from/--to` flags on `cli.ts`.
- [ ] Root scripts: `pnpm eval:report` (once) and `pnpm eval:report --schedule`.

### 3.4 Trend verification + tests (105 min)

- [ ] Generate two seeded reports (one window, then the next) and assert deltas/trends/guardrails compute correctly.
- [ ] Assert empty-window and no-previous-window behavior (delta `undefined`, trend `UNKNOWN`, not `0`.
- [ ] `ReportStore` append-only test: attempt a second `insert` with the same id → unique violation.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/evaluation/src/report-generator.ts` | Report assembly + trends + guardrails |
| `packages/evaluation/src/report-store.ts` | Append-only report persistence |
| `packages/evaluation/src/scheduler.ts` | cron edge |
| `packages/db/migrations/0104_eval_reports.sql` | `evaluation_reports` table |
| `packages/evaluation/src/__tests__/report-generator.test.ts` | Trend/guardrail/append-only tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm eval:report --from … --to …` produces a report with `window`, `generatedAt`, and ≥5 `lines` with `delta`/`trend` populated.
- [ ] Back-to-back windows: a metric that drops below 0.70 emits the precision guardrail string; a CRITICAL+HIGH share above 0.30 emits the inflation guardrail.
- [ ] Empty window input → `EmptyWindowError`, no report persisted.
- [ ] `report_store` has only `insert`/`query` surface — `grep -n "update\|delete" packages/evaluation/src/report-store.ts` returns zero hits.
- [ ] A duplicate report id (`same window + same source_version`) is rejected by the DB unique constraint.
- [ ] `pnpm --filter @harness/evaluation test` green; schedule edge skips cleanly in tests (no real cron thread).
- [ ] Migration `0104` applies; `psql \d evaluation_reports` shows the window index.

---

## 6. Notes & Pitfalls

- **Reports are evidence about the pipeline, not a place to fudge.** Append-only means a mistaken report is superseded by a *new* report (with a correction note in the payload), never edited in place — same rule as Spec 9 §3.2.
- **`delta` vs prior window needs a stable window length.** If windows drift in size (`--from` yesterday vs a full week), deltas are apples-to-oranges. Enforce a fixed default window and warn on non-default lengths.
- **`source_version` is load-bearing.** A precision drop across a deploy boundary is a *version* signal; without it you'll spend hours deciding whether the pipeline or the code changed.
- **The scheduler is best-effort.** In the modular monolith a missed tick is not a data-loss event (backfill exists). Do not build a durable scheduler now — that's re-architecture for a non-problem.
- **Guardrails are alerts for humans, not auto-actions.** A crossed threshold adds a line to the report; it does not flip any behavior. Auto-flip arrives only via calibration + flag (Day 14).
- **Next (Day 08):** the trajectory replay engine — the other half of Spec 11 §5's "replay" substrate, before the A/B harness can compare variants.

---

*Prev: [Day 6 — Evaluation Metrics: Routing Precision/Recall Offline](day-06.md) | Next: [Day 8 — Trajectory Replay Engine (Spec 3 §6.1)](day-08.md)*
