# Day 09 — A/B Shadow Harness: Side-by-Side Review-Routing Variants

| | |
|---|---|
| **Week** | W2 — Evaluation v0 + Spec 10 |
| **Spec refs** | Spec 11 §5 (A/B harness, shadow constraint), Architecture §24.3 (head-to-head exit criterion) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 08 (`ReviewReplayer` + fixture); Day 06 metrics; Day 07 report store |

---

## 1. Objectives

By end of day you will have:

1. An **`AbHarness`** in `@harness/evaluation` that runs a *pipeline variant* — a config bundle of routing weights, retrieval strategy, or thresholds — over the same replayed review and records the variant's metrics.
2. A **head-to-head comparator** that scores variant A vs B on a **predefined metric** and emits a go/no-go result ("B beats A on routing precision by X").
3. The **zero-production-effect guarantee**: the harness runs in shadow, reads live data, writes only to an isolated `ab_experiments` table, and **cannot** publish events or mutate live state.
4. A **variant registration** interface (`PipelineVariant`) so a variant is a declared, versioned artifact — not an ad-hoc config string.

This is the machine Week 4's semantic-retriever shadow work plugs into: two delivery mechanisms of Phase 2 — measure the pipeline *and* prove a change beats the incumbent before it goes live.

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
  inputs: ReviewReplay[];            // a set of replayed reviews (Day 08)
}
```

A variant **declares** what it changes. The harness constructs an isolated evaluation context per variant, swapping config *inside the harness*, never on the live DI graph.

### 2.2 Shadow by construction — isolation at the write boundary

1. **Read-only DB handle** — the harness resolves a `ReadonlyDb` exposing `select` only.
2. **No event bus** — `AbHarness` is constructed *without* `IEventBus`; a variant that tries to publish fails to resolve.
3. **Isolated results** — the only writes go to `ab_experiments`/`ab_runs`, outside the live domain tables.

### 2.3 The comparison gate — "beat the incumbent"

The gate is **predefined and singular**: a variant must name one metric to beat (Spec 11 §5). The `metric` column is written *before* runs execute, so you can't shop the denominator that wins.

```sql
-- packages/db/migrations/0105_ab_harness.sql
CREATE TABLE ab_experiments (id text PRIMARY KEY, variant_a jsonb, variant_b jsonb, metric text, created_at timestamptz DEFAULT now());
CREATE TABLE ab_runs (id text PRIMARY KEY, experiment_id text, variant_id text, metric_value double precision, report jsonb, created_at timestamptz DEFAULT now());
```

---

## 3. Tasks

### 3.1 Migration + `ReadonlyDb` (60 min)
- [ ] Migration `0105_ab_harness.sql` (§2.3); `packages/db/src/readonly-db.ts`.

### 3.2 Variant + experiment types (60 min)
- [ ] `packages/evaluation/src/harness/{variant,compare}.ts`; store full variant snapshots in `ab_experiments` for reproducibility.

### 3.3 `AbHarness.runVariant` (150 min)
- [ ] Build the isolated context per variant; run the variant's ranker path over each replayed review; produce per-review `MetricsReport`s.
- [ ] Write `ab_runs`; ensure **no** writes to `tasks`/`review_decisions`/`attention_assessments`.

### 3.4 Stand up one demonstration pair (90 min)
- [ ] Baseline A = `keyword` ranker (current weights 0.7/0.3). Variant B = keyword with a *deliberately different* weight tuple, to prove the comparison end-to-end without waiting on Week 4.
- [ ] Run the pair over the Day-08 fixture; record an `ab_experiments` row + two `ab_runs`.

### 3.5 Isolation + gate tests (120 min)
- [ ] Isolation test: a variant smuggling a domain write fails at the type/constructor boundary.
- [ ] Gate test: improving variant → `go: true`; tie → `TIE, go: false`.
- [ ] Zero-production-effect: after the pair, `tasks`/`review_decisions` row counts unchanged.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0105_ab_harness.sql` | `ab_experiments` + `ab_runs` |
| `packages/db/src/readonly-db.ts` | `ReadonlyDb` |
| `packages/evaluation/src/harness/{variant,compare,ab-harness}.ts` | Variant + gate + harness |
| `packages/evaluation/src/__tests__/ab-harness.test.ts` | Isolation + gate tests |

---

## 5. Acceptance Criteria

- [ ] The demo A/B pair produces `ab_experiments` + 2 `ab_runs`; `compare` emits a winner on the predefined metric.
- [ ] Zero-production-effect: `tasks`/`review_decisions` counts unchanged after the run.
- [ ] `grep -n "IEventBus" packages/evaluation/src/harness/*.ts` returns zero (constructor takes no bus).
- [ ] `grep -n "\.insert\|\.update\|\.delete" packages/evaluation/src/harness/*.ts` returns zero (`ReadonlyDb` only).
- [ ] A variant that doesn't beat the incumbent returns `go: false` with `delta`.
- [ ] The `metric` column is fixed before runs (no UPDATE path).
- [ ] `pnpm --filter @harness/evaluation test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **"Shadow" is a write-boundary property, not a config flag.** No bus, readonly db, isolated tables — test the *absence* of the capability, not its consent.
- **Do not metric-shop.** The experiment's `metric` is written before the runs; a variant that wins only on an unnamed metric is not a win.
- **Replay drift is not a variant effect.** A big delta must first rule out replay divergence (Day 08's `matched === false`). The harness must distinguish "variant won" from "replay was inconsistent."
- **The harness reuses offline metrics, not live gauges.** `runVariant` computes its own per-variant `MetricsReport`; touching Day-04's registry would leak a shadow experiment into production dashboards.
- **Keep variants versioned.** `variant_a/b` are snapshots; later edits create a new experiment, never mutate the recorded one.
- **Next (Day 10):** promote Spec 10 (Observability/Governance) + lock the Week-2 metrics checkpoint.

---

*Prev: [Day 08 — Review Replay Engine: Replay a Recorded Review](day-08.md) | Next: [Day 10 — Promote Spec 10 + Week 2 Metrics Checkpoint](day-10.md)*