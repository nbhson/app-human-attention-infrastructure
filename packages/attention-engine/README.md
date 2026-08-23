# @harness/attention-engine — Routing, Scoring & Auto-Approve

Decides how much human attention every change deserves: the five-factor
attention score, routing to review-or-approve, weight/calibration seams, and the
guard-railed auto-approve path.

**Status:** Phase 1 + calibration/auto-approve (Phase 2) complete (as-built) ·
**Boundary rule:** engine — imports only shared packages.

---

## Purpose

1. **Score** a change over five factors (risk, impact, novelty, complexity, confidence).
2. **Combine** them into a single `combinedPriority ∈ [0, 1]` under a calibrated weight vector.
3. **Label & route** — map the score to `LOW / MEDIUM / HIGH / CRITICAL` and a routing target.
4. **Auto-approve safely** — behind a gate, a kill-switch, a daily budget, and audit sampling.
5. **Adapt thresholds** from measured error rate, never by fiat.
6. **Emit decisions** as events for the orchestrator.

---

## Scoring model

```text
              change + verification + context + project rules
                               │
                               ▼
                    ┌──────────────────────┐
                    │   factor collection  │  (size, blast radius, author
                    │   factors.ts         │   history, dependency sensitivity…)
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │   combined scoring    │
                    │   scoring.ts          │
                    └──────────┬───────────┘
                               ▼
          combinedPriority = Σ  weightₖ · scoreₖ
          (confidence enters *inverted*: w_conf · (1 − confidenceScore))
                               │
                               ▼
                    ┌──────────────────────┐
                    │   label + routing    │
                    │   policy.ts / router.ts │
                    └──────────┬───────────┘
               ┌───────────────┴───────────────┐
               ▼                               ▼
        TO_HUMAN_REVIEW                 AUTO_APPROVABLE (gated)
               │                               │
               ▼                               ▼
        review queue                    auto-approve (gate → sampler → executor)
```

- **`PRIORITY_WEIGHTS`** (placeholder, sum = 1.0): `risk .35`, `impact .25`,
  `novelty .15`, `complexity .10`, `confidence .15`.
- **The confidence inversion** is intentional and load-bearing: *low* agent
  confidence **raises** priority — the exact inverse of the v0.1 spec bug.
- Unavailable factors hold a neutral `0.5` placeholder; their weight is
  redistributed across the rest (`factorsUnavailable` records which).

---

## Routing & auto-approve

| Component | What it does |
| --- | --- |
| `thresholds/threshold-store.ts` | Persisted routing thresholds. |
| `thresholds/adaptive-threshold.ts` | Adapt thresholds from observed error rate. |
| `thresholds/daily-budget.ts` | Daily automatic-approval budget guard. |
| `thresholds/inflation-monitor.ts` | Detects automatic-approval "inflation". |
| `auto-approve/gate.ts` | Decides whether a change may auto-approve. |
| `auto-approve/kill-switch.ts` | Global kill-switch — forces everything back to review. |
| `auto-approve/sampler.ts` | Routes a sampled fraction to review for audit. |
| `auto-approve/executor.ts` | Applies the approval (records `AUTO_APPROVED`). |

**Kill-switch > automation:** the switch turns all auto-approve into review
instantly, whatever the scores say. The sampler keeps auto-approve honest by
auditing a fraction. An auto-approved-then-human-rejected change emits
`evaluation.escalation_leakage` (the auto-approvable-but-rejected signal).

---

## Core data shapes

| Type | What it is |
| --- | --- |
| `AttentionWeights` | Five non-negative weights summing to 1.0. |
| `FactorScores` | `risk / impact / novelty / complexity / confidenceScore`, each `[0, 1]`. |
| `AttentionAssessment` | Persisted assessment: `id`, `taskId`, `changeId`, `artifactId`, `factors`, `factorsUnavailable`, `combinedPriority`, `label`. |
| `PriorityLabel` | `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`. |

---

## Modules

| Module | What it provides |
| --- | --- |
| `types.ts` | `AttentionWeights`, `FactorScores`, `AttentionAssessment`, `PriorityLabel`, `PRIORITY_WEIGHTS`, `FACTOR_KEYS`. |
| `factors.ts` | Factor collection. |
| `scoring.ts` | Weighted combination (confidence-inverted). |
| `policy.ts` | Routing + threshold policy. |
| `router.ts` | Route a scored change. |
| `weights/weights-provider.ts` | Weight source (defaults; calibration may override). |
| `thresholds/*` | threshold store, adaptive threshold, daily budget, inflation monitor. |
| `auto-approve/*` | gate, kill-switch, sampler, executor. |
| `attention-subscriber.ts` | Consumes pipeline events to trigger assessments. |

---

## Interaction with other packages

```text
                 orchestrator (task events)
                        │  (via @harness/event-bus)
                        ▼
          ┌──────────────────────────┐        ┌──────────────────────┐
          │     attention-engine      │──────▶ │  review (queue)      │
          └──────────────────────────┘        └──────────────────────┘
                 ▲          ▲
                 │          │
        artifact-tracker   verification-engine
        (artifacts/changes) (verification.completed)
```

The engine never calls the orchestrator or review directly — it only subscribes
to events and publishes `attention.assessment_created` / `attention.item_routed`
/ `attention.threshold_adjusted` / `attention.inflation_detected`. `auto_approve`
is itself a `TaskTrigger` actor (`attention.item_routed` → approval via the executor).

---

## Key invariants

- **Evidence before confidence.** A high auto-approve threshold without
  calibration evidence is treated as *less* trustworthy; thresholds adapt from
  measured outcomes.
- **Convex weights.** Any weight vector must be a convex combination (≥ 0, sums
  to 1.0).
- **Kill-switch & sampler always win** over automation.

---

## Directory structure

```
src/
├── index.ts
├── types.ts               # score/assessment types + PRIORITY_WEIGHTS
├── factors.ts
├── scoring.ts
├── policy.ts
├── router.ts
├── attention-subscriber.ts
├── weights/weights-provider.ts
├── thresholds/            # threshold-store, adaptive-threshold, daily-budget, inflation-monitor
└── auto-approve/          # gate, kill-switch, sampler, executor
```

## Public API surface

```typescript
// types: AttentionWeights, FactorScores, AttentionAssessment, PriorityLabel,
//        PRIORITY_WEIGHTS, FACTOR_KEYS, FactorKey
// scoring/factors/policy/router + WeightsProvider
// thresholds: ThresholdStore, AdaptiveThreshold, DailyBudget, InflationMonitor
// auto-approve: Gate, KillSwitch, Sampler, Executor
// AttentionSubscriber
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`; thresholds/weights are seeded at
startup. The `attention.item_routed` event drives review-queue creation in
`@harness/review`.