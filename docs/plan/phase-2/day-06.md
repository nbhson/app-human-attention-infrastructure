# Day 06 — Evaluation Metrics: Routing Precision/Recall Offline

| | |
|---|---|
| **Week** | W2 — Evaluation v0 + Spec 10 |
| **Spec refs** | Spec 11 §4.1 (routing quality), §4.2 (attention efficiency), §3 (inputs); Spec 9 §1 (evidence = ground truth) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 05 (Week-1 checkpoint green); `event_log`, `review_decisions.actor_id`, `assessment_feedback.was_useful` populated by real runs |

---

## 1. Objectives

By end of day you will have:

1. A new **`packages/evaluation`** owning an offline `MetricsComputer` that reads the event/evidence/decision store — never the live pipeline — and computes Spec 11's Phase-2 metrics: routing precision, recall, escalation leakage, and attention efficiency.
2. A **labeling rule** for each metric: what "actually warranted review" and "later produced rework/defect" mean, derived from ground truth in the store (not vibes).
3. A **reproducible computation** — same inputs, same numbers, run anywhere — with a CLI (`pnpm eval:metrics`) and unit tests on a seeded fixture.
4. `setGauge` wiring so Day-04's Prometheus gauges are populated from these offline results.

The distinction that matters: **Verification scores a change; Evaluation scores the pipeline.** This day turns "we have a decision log" into "here is the number that says whether routing a change to a human was the right call."

---

## 2. Design Decisions

### 2.1 Ground-truth labels (explicit, from Spec 11 §4.1)

| Signal | Meaning | Source | Label |
|--------|---------|--------|-------|
| `warranted_review` | change actually needed human eyes | final decision ∈ `{REJECT, REWORK}` **or** later defect traced to the change | `review_decisions.decision`, downstream REWORK |
| `defect_later` | a past "fly-through" later produced rework/defect | a prior auto-passed task later re-enters REWORK | `task_state_history` |

Precision = `warranted_review AND routed_to_human / routed_to_human`. Recall = `routes that flew through but defect_later / (flew-through + defect_later)`.

**Ground truth is the decision + downstream rework, not the Attention Engine's own prediction.** A precision metric that counts "the engine predicted HIGH and a human looked" as ground truth is circular.

### 2.2 Offline, read-only, deterministic

```typescript
// packages/evaluation/src/metrics-computer.ts
export interface MetricsInput {
  from: Date; to: Date;                 // window — metrics are always windowed
  decisionLog: DecisionRow[];           // review_decisions + assessments
  reworkLog: ReworkRow[];               // task_state_history (REWORK)
  routeLog: RouteRow[];                 // attention.item_routed events
}
export class MetricsComputer {
  compute(input: MetricsInput): MetricsReport {
    return {
      routing: { precision: this.precision(input), recall: this.recall(input), escalationLeakage: this.leakage(input) },
      efficiency: { humanMinutesPerAccept: this.humanMinutesPerAccept(input), inflationRatio: this.inflationRatio(input) },
    };
  }
}
```

Pure function of its inputs — no `Date.now()`, no env, no DB calls inside the compute path. The caller loads the windowed rows. That is what makes the numbers reproducible in CI and in the A/B harness (Day 09).

### 2.3 `humanMinutesPerAccept` — measured dwell, not guessed

`sum(dwell) / accepted_count` per window, from the Day-04 dwell histogram's raw data (`claimed_at → decided_at`). Missing dwell reports `NaN → omitted`, never `0` — a missing measure is not a zero measure.

### 2.4 Repo shape + boundary

`@harness/evaluation` imports `@harness/domain`, `@harness/db`, `@harness/di`, `@harness/observability` (for `setGauge`). It does **not** import any engine.

---

## 3. Tasks

### 3.1 Scaffold `packages/evaluation` (45 min)
- [ ] `package.json` (`@harness/evaluation`); deps domain/db/di/observability.
- [ ] `src/report.ts` — `MetricsReport` type; `metrics-computer.ts` skeleton.

### 3.2 Loader + labels (90 min)
- [ ] `src/loader.ts` — three windowed queries: decisions (with `actor_id`, `was_useful`, assessment join), rework (state history), routes.
- [ ] `src/labels.ts` — §2.1 rules as pure functions over the loaded rows.

### 3.3 Precision / recall / leakage (90 min)
- [ ] Implement the §4.1 metrics: zero-denominator → `undefined`; window with no decisions → empty report.
- [ ] Unit tests on a seeded fixture where true precision/recall are hand-known.

### 3.4 Efficiency metrics (60 min)
- [ ] `humanMinutesPerAccept` + `inflationRatio` from dwell + label distribution; `setGauge` for the four gauges.

### 3.5 CLI + verification (90 min)
- [ ] `cli.ts` — `--from/--to`; root script `pnpm eval:metrics`.
- [ ] Run against the Day-05 demo DB; deterministic (two runs, same output).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/evaluation/src/{metrics-computer,loader,labels,report,cli}.ts` | Offline metric computation |
| `packages/evaluation/src/__tests__/metrics-computer.test.ts` | Known-answer tests |
| root `package.json` (updated) | `pnpm eval:metrics` script |
| `docs/architecture/wiring-map.md` (updated) | `TOKENS.MetricsComputer` |

---

## 5. Acceptance Criteria

- [ ] `pnpm eval:metrics --from … --to …` prints precision/recall/leakage/human-minutes/inflation for a real window.
- [ ] Seeded fixture asserts a **known** precision and recall to 4 decimal places (hand-computed first).
- [ ] Zero-denominator and empty-window inputs return `undefined`/empty, never throw or produce `NaN`/`Infinity`.
- [ ] Two consecutive runs produce byte-identical output (determinism).
- [ ] `setGauge` updates `harness_routing_precision` (stub meter test).
- [ ] `grep -r "from '@harness" packages/evaluation/src` shows only domain/db/di/observability.
- [ ] Ground-truth labeling uses decision/rework store only — `grep -r "prediction" packages/evaluation/src` returns nothing.

---

## 6. Notes & Pitfalls

- **Do not score with the engine's own prediction.** "HIGH and reviewed" is circular. Labels come from the *outcome*.
- **`NaN` is a lie; `undefined` is an honest hole.** A zero denominator omits the metric and logs why.
- **Windows must be configurable.** A precision number without a `[from, to]` is meaningless; every report carries its window.
- **The loader is also the replay read surface (Day 08).** Keep queries pure and windowed — a loader with side effects makes replay non-deterministic.
- **Downstream-defect recall is a lagging metric.** A fly-through that defects next week isn't in this week's recall; state the lag horizon explicitly.
- **Next (Day 07):** the report generator that turns these numbers into a scheduled, trended deliverable.

---

*Prev: [Day 05 — Week 1 Checkpoint: Identity & Observability](day-05.md) | Next: [Day 07 — Report Generator: Scheduled Metrics & Trends](day-07.md)*