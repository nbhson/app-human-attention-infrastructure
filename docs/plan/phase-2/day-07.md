# Day 07 — Report Generator: Scheduled Metrics & Trends

| | |
|---|---|
| **Week** | W2 — Evaluation v0 + Spec 10 |
| **Spec refs** | Spec 11 §4 (metrics), §5 (reports gate rollouts); Phase-1 day-27 audit cookbook (Q3–Q6 → trends) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 06 (`MetricsComputer` + `pnpm eval:metrics`) |

---

## 1. Objectives

By end of day you will have:

1. A **`ReportGenerator`** in `@harness/evaluation` that assembles a windowed `MetricsReport` into a human-readable summary: current numbers, deltas vs the prior window, and trend direction.
2. A **scheduled job** (`pnpm eval:report --schedule`) that writes reports on a cron and appends each to a **report history** (Postgres table), so "what were the numbers last week?" is a query.
3. **Trend detection** — a flag on each metric crossing a simple threshold, so the report says *what changed*.
4. A **self-validating report** — refuses to emit for an empty/windowless input (the Day-06 empty-window guarantee enforced at the product boundary).

The numbers exist as of yesterday; without this day they are a CLI printout. A report is how a metric becomes a *decision input* — Week 3's calibration gates on the before/after *report*.

---

## 2. Design Decisions

### 2.1 Report shape — current value, delta, trend, guardrail

```typescript
// packages/evaluation/src/report.ts
export interface MetricLine {
  key:          string;               // e.g. "routing.precision"
  value:        number | undefined;
  previousValue: number | undefined;
  delta:        number | undefined;
  trend:        'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';
  guardrail?:   string;               // human string when a threshold is crossed
}
export interface MetricsReport {
  window:      { from: string; to: string };
  generatedAt: string;
  lines:       MetricLine[];
}
```

Trend is **delta-derived, not model-derived**: `value` vs `previousValue` over a fixed window length.

### 2.2 Guardrail thresholds (v0 — loud, reversible)

| Metric | Direction | Threshold | Guardrail message |
|--------|-----------|-----------|-------------------|
| `routing.precision` | DOWN | < 0.70 | "Precision below 0.70 — review the routing thresholds" |
| `routing.recall` | DOWN | < 0.60 | "Recall below 0.60 — auto-approvable set is leaking defects" |
| `attention.inflationRatio` | UP | CRITICAL+HIGH > 0.30 | "Inflation alert — Spec 6 §4.1 ceiling crossed" |
| `efficiency.humanMinutesPerAccept` | UP | +50% week-over-week | "Human cost per accept rising sharply" |

Thresholds live in a constants file, not inline — Day 13 tunes them from real data.

### 2.3 Report persistence — append-only `evaluation_reports`

```sql
-- packages/db/migrations/0104_eval_reports.sql
CREATE TABLE evaluation_reports (
  id            text PRIMARY KEY,
  window_from   timestamptz NOT NULL,
  window_to     timestamptz NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  report        jsonb NOT NULL,
  source_version text NOT NULL
);
CREATE INDEX evaluation_reports_window_idx ON evaluation_reports(window_from, window_to);
```

Append-only (never UPDATE a published report — same rule as evidence). `source_version` is required so trend comparison attributes changes to code.

### 2.4 Scheduling — in-process cron, not a new service

`node-cron` inside the API (`EVAL_REPORT_SCHEDULE` env), with a `--once` mode for CLI/tests. A missed tick is logged, not a lost fact (reports backfill via `--from/--to`).

---

## 3. Tasks

### 3.1 Report shape + generator (75 min)
- [ ] `packages/evaluation/src/report.ts` — `MetricLine`/`MetricsReport`.
- [ ] `packages/evaluation/src/report-generator.ts` — `generate(current, previous)`; refuse empty windows (`EmptyWindowError`).

### 3.2 Persistence + migration (60 min)
- [ ] Migration `0104_eval_reports.sql`; `ReportStore` (`insert` + `listByWindow`) with **no** `update`/`delete` methods.
- [ ] Append-only enforced by API shape.

### 3.3 Scheduler + CLI (60 min)
- [ ] `packages/evaluation/src/scheduler.ts` — `node-cron`; `--once`/`--schedule`/`--from/--to` flags.
- [ ] Root scripts: `pnpm eval:report`.

### 3.4 Trend verification + tests (105 min)
- [ ] Two seeded reports (consecutive windows) → deltas/trends/guardrails computed correctly.
- [ ] Empty-window and no-previous-window behavior (delta `undefined`, trend `UNKNOWN`).
- [ ] `ReportStore` append-only: duplicate insert → unique violation.

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

- [ ] `pnpm eval:report --from … --to …` produces a report with `window`, `generatedAt`, and ≥5 `lines`.
- [ ] A metric dropping below 0.70 emits the precision guardrail; CRITICAL+HIGH > 0.30 emits the inflation guardrail.
- [ ] Empty window input → `EmptyWindowError`, no report persisted.
- [ ] `report_store` exposes only `insert`/`query` — `grep -n "update\|delete"` returns zero.
- [ ] A duplicate report id is rejected by the DB unique constraint.
- [ ] Migration `0104` applies; `\d evaluation_reports` shows the window index.

---

## 6. Notes & Pitfalls

- **Reports are evidence about the pipeline, not a place to fudge.** Append-only means a mistaken report is superseded by a *new* report, never edited in place.
- **`delta` needs a stable window length.** Drifting window sizes make deltas apples-to-oranges; enforce a fixed default and warn on non-default.
- **`source_version` is load-bearing.** A precision drop across a deploy boundary is a *version* signal.
- **The scheduler is best-effort.** No durable scheduler — backfill exists; a missed tick is not data loss.
- **Guardrails are alerts for humans, not auto-actions.** A crossed threshold adds a line; it does not flip behavior (auto-flip arrives only via calibration + flag, Day 14).
- **Next (Day 08):** the review replay engine — the other half of Spec 11 §5's "replay" substrate, before the A/B harness can compare variants.

---

*Prev: [Day 06 — Evaluation Metrics: Routing Precision/Recall Offline](day-06.md) | Next: [Day 08 — Review Replay Engine: Replay a Recorded Review](day-08.md)*