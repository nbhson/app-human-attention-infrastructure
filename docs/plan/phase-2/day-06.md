# Day 06 — Evaluation Metrics: Routing Precision/Recall Offline

| | |
|---|---|
| **Week** | 2 — Evaluation v0 + Spec 10 |
| **Spec refs** | Spec 11 §4.1 (routing quality), §4.2 (attention efficiency), §3 (inputs); Spec 9 §1 (evidence = ground truth) |
| **Estimated effort** | 7 hours |
| **Prerequisites** | Day 05 (Week-1 checkpoint green); `event_log`, `review_decisions.actor_id`, `assessment_feedback.was_useful` populated by real runs |

---

## 1. Objectives

By end of day you will have:

1. A new **`packages/evaluation`** owning an offline `MetricsComputer` that reads the event/evidence/decision store — never the live pipeline — and computes Spec 11's Phase-2 metrics: routing precision, routing recall, escalation leakage, and attention efficiency.
2. A **labeling rule** for each metric: what "actually warranted review" and "later produced rework/defect" mean, derived from ground truth in the store (not vibes).
3. A **reproducible computation** — same inputs, same numbers, run anywhere — with a CLI (`pnpm eval:metrics`) and unit tests on a seeded fixture.
4. `setGauge` wiring so Day-04's Prometheus gauges are populated from these offline results.

The distinction that matters: **Verification (7) scores a change; Evaluation (11) scores the pipeline.** This day builds the machine that turns "we have a decision log" into "here is the number that says whether routing a change to a human was the right call."

---

## 2. Design Decisions

### 2.1 Ground-truth labels (explicit, from Spec 11 §4.1)

| Signal | Meaning | Source | Label |
|--------|---------|--------|-------|
| `warranted_review` | change actually needed human eyes | final decision ∈ {`REJECT`, `REWORK`} **or** later defect traced to the change | `review_decisions.decision`, downstream REWORK |
| `defect_later` | a past "fly-through" later produced rework/defect | task whose prior change was auto-passed then re-entered REWORK/`AWAITING_HUMAN_INTERVENTION` | `task_state_history` |

Precision = `warranted_review AND routed_to_human / routed_to_human`. Recall = `routes-that-flew-through but defect_later / (routes-that-flew-through + defect_later)` — i.e. of the changes that actually needed attention, how many did we route.

**Ground truth is the decision + downstream rework, not the Attention Engine's own prediction.** A precision metric that counts "the engine predicted HIGH and a human looked" as ground truth is circular. The labels must come from outside the scoring path.

### 2.2 Offline, read-only, deterministic

```typescript
// packages/evaluation/src/metrics-computer.ts
export interface MetricsInput {
  from: Date; to: Date;                 // window — metrics are always windowed
  decisionLog: DecisionRow[];           // from review_decisions + assessments
  reworkLog: ReworkRow[];               // from task_state_history (REWORK/AWAITING_HUMAN_INTERVENTION)
  routeLog: RouteRow[];                 // attention.item_routed events
}

export class MetricsComputer {
  compute(input: MetricsInput): MetricsReport {
    return {
      routing: {
        precision: this.precision(input),
        recall:    this.recall(input),
        escalationLeakage: this.leakage(input),
      },
      efficiency: {
        humanMinutesPerAccept: this.humanMinutesPerAccept(input),
        inflationRatio:       this.inflationRatio(input),
      },
    };
  }
}
```

Pure function of its inputs. No `Date.now()`, no env, no DB calls inside the compute path — the caller loads the windowed rows and hands them in. That is what makes the numbers reproducible in CI and in the A/B harness (Day 09).

### 2.3 `humanMinutesPerAccept` — measured dwell, not guessed

Attention efficiency runs on the Day-04 dwell histogram's raw data: `sum(dwell) / accepted_count` per window. The `review_dwell` is recorded at decision time (`claimed_at → decided_at`); today we sum it over accepted changes. If dwell is missing, the metric reports `NaN → omitted`, not `0` (a missing measure is not a zero measure — falsifying an efficiency claim is worse than reporting a hole).

### 2.4 Repo shape

```text
packages/evaluation/src/
├── metrics-computer.ts      # pure computation
├── loader.ts                # windowed load from event_log/review_decisions/task_state_history
├── labels.ts                # labeling rules from §2.1
├── report.ts                # MetricsReport shape (consumed by Day 07)
└── cli.ts                   # `pnpm eval:metrics --from --to`
```

`@harness/evaluation` imports `@harness/domain`, `@harness/db`, `@harness/di`, `@harness/observability` (for `setGauge`). It does **not** import any engine.

---

## 3. Tasks

### 3.1 Scaffold `packages/evaluation` (45 min)

- [ ] `package.json` — `@harness/evaluation`; deps domain/db/di/observability.
- [ ] `src/report.ts` — `MetricsReport` type + `metrics-computer.ts` skeleton.

### 3.2 Loader + labels (90 min)

- [ ] `src/loader.ts` — three windowed queries: decisions (with `actor_id`, `was_useful`, assessment join), rework (state history), routes (`attention.item_routed`).
- [ ] `src/labels.ts` — implement §2.1's rules as pure functions over the loaded rows.

### 3.3 Precision / recall / leakage (90 min)

- [ ] Implement the three §4.1 metrics with edge-case handling: zero-denominator → `undefined` (not `Infinity`), window with no decisions → empty report.
- [ ] Unit tests on a seeded fixture where the true precision/recall are known by hand.

### 3.4 Efficiency metrics (60 min)

- [ ] `humanMinutesPerAccept` + `inflationRatio` from dwell + label distribution.
- [ ] `setGauge` calls for the four §2.1 gauges after compute.

### 3.5 CLI + verification (90 min)

- [ ] `cli.ts` — argparse `--from/--to`, prints the report; root script `pnpm eval:metrics`.
- [ ] Run against the Day-05 demo DB; paste real numbers into the report doc (Day 07 will consume).
- [ ] Tests: `pnpm --filter @harness/evaluation test` green; deterministic (two runs, same output).

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
- [ ] Seeded fixture test asserts a **known** precision and recall to 4 decimal places (no `toEqual(anything)` — exact numbers, hand-computed first).
- [ ] Zero-denominator and empty-window inputs return `undefined`/empty, never throw or produce `NaN`/`Infinity`.
- [ ] Two consecutive runs over the same window produce byte-identical report output (determinism).
- [ ] `setGauge` updates `harness_routing_precision` on the Day-04 registry (assert in a test with a stub meter).
- [ ] `grep -r "from '@harness" packages/evaluation/src` shows only domain/db/di/observability (no engine imports).
- [ ] Ground-truth labeling uses the decision/rework store only — `grep -r "prediction" packages/evaluation/src` returns nothing (proves no circularity via the engine's own scores).

---

## 6. Notes & Pitfalls

- **Do not score with the engine's own prediction.** Precision measured as "HIGH and reviewed" is circular and tells you nothing. The labels come from the *outcome* (reject/rework/defect), which is the whole point of evidence-before-confidence applied to the harness itself.
- **`NaN` is a lie; `undefined` is an honest hole.** When a denominator is zero, omit the metric and log why. Plotting `NaN` in Grafana silently renders nothing and reads as "0" to a hurried reviewer.
- **Windows must be configurable.** A precision number without a `[from, to]` is meaningless — different windows give different answers. Every report carries its window; never emit an unwindowed aggregate.
- **Replay will hit these queries (Day 08).** The `loader.ts` queries are also the read surface the replay engine re-runs, so keep them pure and windowed — a loader with side effects will make replay non-deterministic.
- **Downstream-defect recall is a lagging metric.** A "fly-through" that defects *next week* won't be in this week's recall. State the lag horizon explicitly in the report; don't silently use only same-window REWORK.
- **Next (Day 07):** the report generator that turns these numbers into a scheduled, trended deliverable.

---

*Prev: [Day 5 — Week 1 Checkpoint: Identity & Observability](day-05.md) | Next: [Day 7 — Report Generator: Scheduled Metrics & Trends](day-07.md)*
