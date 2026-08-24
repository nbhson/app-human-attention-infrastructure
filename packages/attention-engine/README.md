# @harness/attention-engine — Routing, Scoring, Auto-Approve & the Learning Loop

Decides how much human attention every change deserves: the five-factor
attention score, routing to review-or-approve, weight/calibration seams, the
guard-railed auto-approve path, and the measured learning loop that fits and
proposes new weights.

**Status:** v1.0-candidate (as-built) — pending Day 40 exit review ·
**Boundary rule:** engine (R4) — imports only shared packages; never another engine.

---

## Purpose

1. **Score** a change over five factors (risk, impact, novelty, complexity, confidence).
2. **Combine** them into a single `combinedPriority ∈ [0, 1]` under a calibrated weight vector.
3. **Label & route** — map the score to `LOW / MEDIUM / HIGH / CRITICAL` and a routing target.
4. **Auto-approve safely** — behind a gate, a kill-switch, a daily budget, and audit sampling.
5. **Adapt thresholds** from measured error rate, never by fiat.
6. **Emit decisions** as events (e.g. `attention.assessment_created`, `attention.item_routed`).
7. **Run the learning loop** — a four-stage `evaluate → calibrate → deploy → observe`
   cycle that fits a candidate from `was_useful` + judge signals, but **proposes**,
   never silently applies, a weight vector.

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

## Learning loop (Evaluate → Calibrate → measured Deploy)

`learning/` holds the closed learning loop. It is a **structural seam, not a DI
token**, and is not eagerly started — a server entrypoint (or `demo:closed-loop`)
drives `runCycle()` on a cadence.

| Component | What it does |
| --- | --- |
| `learning/collector.ts` | read new `was_useful` + judge + factor facts from the DB. |
| `learning/calibration-job.ts` | fit a candidate through an injected `FitSeam`. |
| `learning/promotion-gate.ts` | `decidePromotion` — the measured PROMOTE/HOLD guardrail. |
| `learning/learning-loop.ts` | four-stage `evaluate → calibrate → deploy → observe` cycle. |
| `learning/cycle-audit.ts` | per-stage + per-cycle audit under one `cycle_id`. |
| `learning/types.ts` | `ReviewFact`, `LearningSample`, `LearningCandidate`, `PromotionDecision`. |

The gate is the invariant made executable: a candidate **PROMOTES** only by winning
its held-out ranking comparison against the incumbent; a **HOLD** (no measured
improvement, or the judge-disagreement column dominates the fit — overfit alarm)
parks the candidate at Deploy (`deploy = held`) and the cycle still completes. The
hot-path `WeightsProvider` (`StaticWeightsAdapter`) keeps returning the placeholder
until a promotion is *explicitly adopted* — the loop proposes, it never applies.

## Core data shapes

| Type | What it is |
| --- | --- |
| `AttentionWeights` | Five non-negative weights summing to 1.0. |
| `FactorScores` | `risk / impact / novelty / complexity / confidenceScore`, each `[0, 1]`. |
| `AttentionAssessment` | Persisted assessment: `id`, `taskId`, `changeId`, `artifactId`, `factors`, `factorsUnavailable`, `combinedPriority`, `label`. |
| `PriorityLabel` | `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`. |

## Modules

| Module | What it provides |
| --- | --- |
| `types.ts` | `AttentionWeights`, `FactorScores`, `AttentionAssessment`, `PriorityLabel`, `PRIORITY_WEIGHTS`, `FACTOR_KEYS`. |
| `factors.ts` | Factor collection. |
| `scoring.ts` | Weighted combination (confidence-inverted). |
| `policy.ts` | Routing + threshold policy. |
| `router.ts` | Route a scored change. |
| `weights/weights-provider.ts` | Weight source (defaults; the learning loop proposes, the operator adopts). |
| `thresholds/*` | threshold store, adaptive threshold, daily budget, inflation monitor. |
| `auto-approve/*` | gate, kill-switch, sampler, executor. |
| `learning/*` | collector, calibration job, promotion gate, learning loop, cycle audit. |
| `attention-subscriber.ts` | Consumes pipeline events to trigger assessments. |

## Interaction with other packages

```text
                 event bus (task/artifact/verification events)
                        │
                        ▼
          ┌──────────────────────────┐        ┌──────────────────────┐
          │     attention-engine      │──────▶ │  review (queue)      │
          └──────────────────────────┘        └──────────────────────┘
```

The engine never calls another engine directly — it subscribes to events and
publishes `attention.assessment_created` / `attention.item_routed` /
`attention.threshold_adjusted` / `attention.inflation_detected`. `auto_approve`
is itself a `TaskTrigger` actor (`attention.item_routed` → approval via the executor).

## Key invariants

- **Evidence before confidence.** A high auto-approve threshold without calibration
  evidence is treated as *less* trustworthy; thresholds adapt from measured outcomes.
- **Convex weights.** Any weight vector must be a convex combination (≥ 0, sums to 1.0).
- **Kill-switch & sampler always win** over automation.
- **Automation proposes, never applies.** A weight vector reaches the hot path only
  via an explicit, human-observed adoption step.

## Directory structure

```
src/
├── index.ts
├── types.ts               # score/assessment types + PRIORITY_WEIGHTS
├── factors.ts / scoring.ts / policy.ts / router.ts
├── attention-subscriber.ts
├── weights/weights-provider.ts
├── thresholds/            # threshold-store, adaptive-threshold, daily-budget, inflation-monitor
├── auto-approve/          # gate, kill-switch, sampler, executor
└── learning/              # collector, calibration-job, promotion-gate, learning-loop, cycle-audit
```

## Public API surface

```typescript
// types: AttentionWeights, FactorScores, AttentionAssessment, PriorityLabel,
//        PRIORITY_WEIGHTS, FACTOR_KEYS, FactorKey
// scoring/factors/policy/router + WeightsProvider
// thresholds: ThresholdStore, AdaptiveThreshold, DailyBudget, InflationMonitor
// auto-approve: Gate, KillSwitch, Sampler, Executor
// learning: CalibrationJob, LearningLoop, decidePromotion, PromotionDecision, LearningRun
// AttentionSubscriber
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`; thresholds/weights are seeded at startup.
The `attention.item_routed` event drives review-queue creation in `@harness/review`.