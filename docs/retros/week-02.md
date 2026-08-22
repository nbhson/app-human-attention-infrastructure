# Phase 2 · Week 2 Retro — Evaluation & Governance

*Day-10 checkpoint (Phase 2). Second pass over the evaluation + observability
stack built across Phase-2 days 06–10. Same rule as prior retros: honest by
design, numbers-first, blameless — and every acceptance criterion is green
before this note is committed.*

## What shipped this week

- **Day 06 — offline routing metrics.** `MetricsComputer` computes
  `routing.precision`, `routing.recall`, `routing.escalationLeakage`,
  `efficiency.humanMinutesPerAccept`, and `efficiency.inflationRatio` from the
  real decision log (assessments × reviewQueue join, `taskStateHistory` defect
  states, and `AttentionItemRouted` route events).
- **Day 07 — report generator + scheduler.** `ReportGenerator` compares a window
  against its predecessor (trends + guardrails); `ReportStore` persists flat
  reports to `evaluation_reports` (append-only, `source_version`-attributed);
  `ReportScheduler` drives a `node-cron` Monday 06:00 tick.
- **Day 08 — trajectory replay.** The `ReplayEngine` re-runs a recorded
  `trajectory_steps` file against the current routing pipeline and reports
  `unmatched` steps — a regression harness for "did the router change its mind".
- **Day 09 — A/B shadow harness.** `AbHarness` runs two weight variants over the
  same trajectory with a compile-time read-only DB (`Pick<DrizzleDB,'select'>`),
  so the shadow *cannot* mutate production rows by construction.
- **Day 10 — Spec 10 promotion.** `docs/core/10_Observability_Governance_v0.1.md`
  is now a standalone contract (identity, observability, metrics, audit, policy)
  rather than plan-street-mentions — authored from what W1–W2 actually built.

## What the checkpoint numbers actually say

The Week-2 checkpoint seeded a decidable window of four real decisions
(real `actor_id`s, real `was_useful` feedback, real dwell), then computed the
offline metrics over it:

| Metric | Value | Read |
|---|---|---|
| `routing.precision` | **0.333** | 1 of 3 human-routed items actually warranted attention (the one `REJECTED` change) |
| `routing.recall` | **0.5** | caught 1 of 2 items that needed attention — the flythrough that later defected slipped past |
| `routing.escalationLeakage` | **1** | the single `AUTO_APPROVABLE` item later entered `REWORK`, i.e. every flythrough leaked |
| `efficiency.humanMinutesPerAccept` | **2.5** | 5 human minutes across 2 accepted items (120s + 180s) |
| `efficiency.inflationRatio` | **0.5** | 2 of 4 items labeled `HIGH` — the classic inflate-to-escalate signal |

These are *real* numbers, but they are a four-row demo, not a population
estimate. The honest reading is:

- **The pipeline is now measured, not yet calibrated.** Every gauge resolves to
  a concrete value from a real decision log — the Day-10 checkpoint rule's
  "non-`undefined`, non-synthetic" test passes. But the values themselves are
  anecdotes: precision 0.333 and recall 0.5 over N=4 tell us the plumbing works,
  not whether the router is any good.
- **Escalation leakage is the number to watch, and it is currently 1.0.** The
  whole point of the auto-approvable path is to spend human attention only where
  it earns a return; a leakage of 1 (every flythrough defected) is the
  worst-case end of the dial. It is also *the* reason Week 3 exists — the
  calibration set is what will move it.
- **Inflation is structurally visible.** `inflationRatio = 0.5` tripped the
  guardrail (Spec 6 §4.1 ceiling) on first run. That is not a bug; it is the
  gauge doing its job. What it should change is the *threshold*, not the report.

## What is still missing (and Week 3 must not paper over it)

- **There is no benchmark corpus and no gold label.** The metrics can only say
  "this happened"; they cannot yet say "this was *right*". Precision/recall here
  are computed against *outcome* (approved/rejected/reworked) as a stand-in for
  truth, but the outcome is a human's judgment, not a labeled ground truth the
  pipeline can be fit against. Week 3 opens with exactly this: extracting the
  `was_useful` + assessment + outcome triple into a calibration dataset (Day 11),
  then fitting weights from real data (Day 12). Until that set exists with real
  labels, every number above is directional.
- **The A/B demo is proven plumbing, not ranking evidence.** The Day-09 pair
  (`BASELINE` keyword weights vs `DEP_HEAVY` dependency-heavy weights) proves
  that the shadow path is safe, read-only, and produces a `winner`/`go`. It is
  **not** a claim that one weighting ranks better than the other — the
  `mean_target_relevance` delta is a mechanism check. Week 5 (Day 29) is where
  the real *semantic-vs-keyword* comparison runs, and it must not borrow the
  Day-09 framing or it will over-claim.

## What is fragile

- **`loadMetricsInput` is three queries joined in code, not one shared read
  model.** Day-06 pulls `decisions`, `taskStateHistory`, and `eventLog` through
  three separate shapes and reconciles them in TypeScript. It is correct and
  test-covered, but it is also the first place a schema drift will produce
  *silently wrong* metrics (a renamed column reads as "no decisions this window"
  rather than "loader broke"). A thin `@harness/db` query layer would collapse
  this — same debt flagged in the Week-1 retro for the smoke test's raw Drizzle
  reach.
- **Guardrails default to `UNKNOWN` and that is the only honest trend until a
  second window exists.** The Day-07 trend logic compares against the previous
  persisted window; with one report, every line is `UNKNOWN`. Fine — but a
  dashboard that renders `UNKNOWN` as a dash instead of a warning hides the
  "we have exactly one data point" state. Week 3 will create the second window;
  the report generator should be re-checked then for correct `UP`/`DOWN` rather
  than assumed.
- **The seed window is `trend===UNKNOWN` by construction.** It produced one
  clean window under the real `source_version`; that is exactly what acceptance
  asked for, but anyone rerunning `seed:metrics-checkpoint` then `eval:report`
  over a *different* window will silently mint a second version-line rather than
  compare. The `(window_from, window_to, source_version)` unique index protects
  against duplicate inserts, not against confusing a seeded window for organic
  data. Keep seed rows labeled (they are, via `rationale`/`title`) and read them
  as fixtures, not telemetry.

## Boundary check

- **No engine reached for another engine.** The shadow harness's read-only
  `Pick<DrizzleDB,'select'>` is a compile-time wall, not a convention; `eval:ab`
  runs against it and `mean_target_relevance` reports correctly with
  `noProductionEffect === true`. The architecture test still asserts R4/R7/R8
  from the real package manifests.

## Decisions / debts carried into Week 3

- **Fit weights, don't hand-tune them.** This week's variants are hand-picked
  (`0.7/0.3` vs `0.3/0.7`). Day 12 must derive weights from the Day-11
  calibration set, and Day 13 must make the *thresholds* adaptive — otherwise
  what we measured this week stays a demo and the leakage stays 1.
- **A benchmark corpus + gold labels is the gate for every downstream claim.**
  Until it exists, precision/recall/leakage are "what the routing *did*", and no
  Week-3 tuning can be validated as an improvement — only as a change.

---

*Checkpoint rule applied: `pnpm eval:metrics` prints real precision/recall/leakage,
`pnpm eval:report` persisted one `evaluation_reports` row under
`source_version "v0.2.0-harness"`, `pnpm eval:replay` replays with
`unmatched===0`, and `pnpm eval:ab` emits a `winner`/`go` with
`noProductionEffect===true`. lint, typecheck, full test suite, and E2E are green
before this note is committed. R4/R7/R8 and the no-engine-imports-engine rule
are asserted by `packages/di/src/__tests__/architecture.test.ts`.*