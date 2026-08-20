# Day 09 — A/B Shadow Harness: Side-by-Side Pipeline Variants

| | |
|---|---|
| **Week** | 2 — Evaluation v0 + Spec 10 |
| **Spec refs** | Spec 11 §5 (A/B harness, shadow constraint), Spec 3 §6.1 (replay), Architecture §24.3 (head-to-head exit criterion) |
| **Estimated effort** | 8 hours |
| **Prerequisites** | Day 08 (`TrajectoryReplayer` + fixture); Day 06 metrics; Day 07 report store |

---

## 1. Objectives

By end of day you will have:

1. An **`AbHarness`** in `@harness/evaluation` that runs a *pipeline variant* — a config bundle of ranking weights, retrieval strategy, or thresholds — over the same replayed trajectory and records the variant's metrics.
2. A **head-to-head comparator** that scores variant A vs variant B on a **predefined metric** and emits a go/no-go result ("B beats A on routing precision by X").
3. The **zero-production-effect guarantee**: the harness runs in a shadow sandbox, reads live data, writes only to an isolated `ab_experiments` table, and **cannot** publish events or mutate live state.
4. A **variant registration** interface (`PipelineVariant`) so a variant is a declared, versioned artifact — not an ad-hoc config string.

By day's end the two headline delivery mechanisms of Phase 2 — measure the pipeline *and* prove a change beats the incumbent before it goes live — are wired. This is the machine that Week 4's semantic-retriever shadow work plugs into.

---

## 2. Design Decisions

### 2.1 Variant = executable config over the replay, nothing more

```typescript
// packages/evaluation/src/harness/variant.ts
export interface PipelineVariant {
  variantId: string;                 // "baseline-keyword" | "semantic-shadow-1536"
  description: string;
  contextRanker: 'keyword' | 'semantic';      // which ranker path to exercise (shadow: never mutates default)
  rankWeights?: { keywordOverlap: number; dependencyProximity: number; semantic?: number };
  attentionWeights?: { risk: number; impact: number; novelty: number; complexity: number; confidence: number };
}

export interface VariantConfig {
  name: string;
  variant: PipelineVariant;
  inputs: ReplayInput[];             // a set of replayed trajectories (Day 08)
}
```

A variant **declares** what it changes. It is not a live mutation of the running pipeline: the harness constructs an isolated evaluation context per variant, swapping the config *inside the harness*, never on the live DI graph.

### 2.2 Shadow by construction — isolation at the write boundary

The harness must be unable to alter production state. Three mechanical guarantees:

1. **Read-only DB handle** — the harness resolves a `ReadonlyDb` wrapper exposing `select` only (no `insert/update/delete`). Compile-time denial.
2. **No event bus** — `AbHarness` is constructed *without* `IEventBus`; variant runs that try to publish would fail to resolve. This is enforced by the constructor signature, not a runtime flag.
3. **Isolated results** — the only writes go to `ab_experiments` (and `ab_runs`), clearly outside the live domain tables.

```sql
-- packages/db/migrations/0105_ab_harness.sql
CREATE TABLE ab_experiments (
  id          text PRIMARY KEY,               -- UUIDv7
  variant_a   jsonb NOT NULL,                 -- PipelineVariant snapshot
  variant_b   jsonb NOT NULL,
  metric      text NOT NULL,                  -- the predefined comparison metric
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ab_runs (
  id            text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES ab_experiments(id),
  variant_id    text NOT NULL,                -- A or B
  metric_value  double precision NOT NULL,
  report        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### 2.3 The comparison gate — "beat the incumbent"

```typescript
// packages/evaluation/src/harness/compare.ts
export interface AbOutcome {
  experimentId: string;
  metric: string;
  aValue: number; bValue: number;
  delta: number;                      // b - a
  winner: 'A' | 'B' | 'TIE';
  go: boolean;                        // true iff B > A (for "higher is better" metrics)
  noProductionEffect: boolean;        // asserted by the isolation tests, always true here
}
```

The gate is **predefined and singular**: a variant must name one metric it must beat (Spec 11 §5's "beat the incumbent"). No post-hoc metric shopping — the metric is fixed in the experiment row *before* the runs execute, so you can't pick the denominator that wins.

---

## 3. Tasks

### 3.1 Migration + `ReadonlyDb` (60 min)

- [ ] Migration `0105_ab_harness.sql` (§2.2).
- [ ] `packages/db/src/readonly-db.ts` — `ReadonlyDb` exposing `select` only; wire the harness to resolve it.

### 3.2 Variant + experiment types (60 min)

- [ ] `packages/evaluation/src/harness/variant.ts` + `compare.ts` (§2.1/§2.3).
- [ ] `PipelineVariant` versioning: store the full variant snapshot in `ab_experiments` so a historical comparison is reproducible.

### 3.3 `AbHarness.runVariant` (150 min)

- [ ] Build the isolated evaluation context per variant; run the variant's ranker path over each replayed trajectory; produce per-trajectory `MetricsReport`s.
- [ ] Write `ab_runs` rows; ensure **no** writes to `tasks`/`review_decisions`/`attention_assessments` etc.

### 3.4 Stand up one demonstration pair (90 min)

- [ ] Baseline A = `keyword` ranker (current weights 0.7/0.3). Variant B = `keyword` ranker with a *deliberately different* weight tuple, so the comparison is proven end-to-end without waiting on Week 4's semantic path.
- [ ] Run the pair over the Day-08 fixture set; record an `ab_experiments` row + two `ab_runs`.

### 3.5 Isolation + gate tests (120 min)

- [ ] Isolation test: construct the harness, attempt a "variant" that calls a domain write via a smuggled reference — assert it fails at the type/constructor boundary (no event bus injected).
- [ ] Gate test: a variant B that improves precision → `go: true, winner: 'B'`; a tie → `TIE, go: false`.
- [ ] Zero-production-effect test: run the demo pair, then assert `tasks`/`review_decisions` row counts are unchanged.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0105_ab_harness.sql` | `ab_experiments` + `ab_runs` |
| `packages/db/src/readonly-db.ts` | `ReadonlyDb` |
| `packages/evaluation/src/harness/{variant,compare}.ts` | Variant + gate |
| `packages/evaluation/src/harness/ab-harness.ts` | The harness |
| `packages/evaluation/src/__tests__/ab-harness.test.ts` | Isolation + gate tests |

---

## 5. Acceptance Criteria

- [ ] The Demo A/B pair produces `ab_experiments` + 2 `ab_runs` rows; `compare` emits a winner on the predefined metric.
- [ ] Zero-production-effect invariant holds: after a harness run, `SELECT count(*) FROM tasks` and `review_decisions` are unchanged (test asserts it).
- [ ] The harness constructor does **not** take an `IEventBus` — `grep -n "IEventBus" packages/evaluation/src/harness/*.ts` returns zero.
- [ ] The harness resolves `ReadonlyDb` — `grep -n "\.insert\|\.update\|\.delete" packages/evaluation/src/harness/*.ts` returns zero.
- [ ] A variant that does not beat the incumbent on the fixed metric returns `go: false` with `delta` in the outcome.
- [ ] Metric is fixed **before** runs — the experiment row is written with its `metric` column, and changing it afterward requires a new experiment (assert no UPDATE path exists).
- [ ] `pnpm --filter @harness/evaluation test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **"Shadow" is a write-boundary property, not a config flag.** If `zeroProductionEffect` is a boolean someone can forget to set, it will be forgotten. Make it structural: no bus, readonly db, isolated tables. Test the *absence* of the capability, not its consent.
- **Do not metric-shop.** The experiment's `metric` column is written before the runs. If a variant only wins on a metric nobody named, that's not a win — that's the exact published-vs-predefined failure the harness exists to prevent (Spec 11 §5).
- **Replay drift is not a variant effect.** If the A/B comparison shows a big delta, first rule out replay divergence (Day 08's `unmatched > 0`). A harness that can't distinguish "variant beat incumbent" from "replay was inconsistent" will mis-calibrate Week 3.
- **The harness reuses the offline metrics, not live gauges.** `runVariant` computes its own per-variant `MetricsReport`; it must not touch Day-04's in-process registry, or a "shadow" experiment leaks into production dashboards.
- **Keep variants versioned.** `variant_a/b` in `ab_experiments` are snapshots; later edits to a variant must create a new experiment, never mutate the recorded one — otherwise historical comparisons silently retcon.
- **Next (Day 10):** promote Spec 10 (Observability/Governance) to a standalone spec and lock the Week-2 metrics checkpoint.

---

*Prev: [Day 8 — Trajectory Replay Engine (Spec 3 §6.1)](day-08.md) | Next: [Day 10 — Promote Spec 10 + Week 2 Metrics Checkpoint](day-10.md)*
