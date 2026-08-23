# Phase 3 · Week 7 Retro — The loop closes, and the gate stays human

*Day-35 checkpoint (Phase 3). Week 7's milestone is written as "the closed loop,
demonstrable". The discipline says a milestone earns that word only by running
end-to-end **and** proving its moral core: the learning loop tunes calibration and
routing, and never once reaches past them into the human APPROVE/REJECT gate. The
week ends **green**: Days 31–34 built the pipeline (collect → fit → gate), the
usefulness signal, the correlation-joined cycle, and an optional durable transport;
Day 35 makes it one observable, re-entering run that asserts the gate stayed human.
Numbers-first, blameless, green before committed.*

## What shipped this week (Days 31–35)

- **Day 31 — the pipeline.** `CalibrationJob` (collect → window → fit → gate) across
  two structural seams (`CollectSeam`/`FitSeam` — the boundary crossing to
  `@harness/evaluation`, which `attention-engine` may not import), a measured
  PROMOTE/HOLD gate (`decidePromotion`), and the "automation stops at the measured
  gate" invariant: a promoted candidate is never silently applied.
- **Day 32 — the usefulness signal.** `UsageLearner` turns per-source usefulness into
  a bounded, time-decayed ranking signal; `ReRankInput.learnedUsage` feeds it, with
  the neutral default preserved when no learning has happened.
- **Day 33 — the cycle.** `LearningLoop` (Evaluate → Calibrate → Deploy → Observe)
  with a `CycleAudit` that joins every stage + the terminal outcome under **one
  `cycle_id`**; Observe is the feed-forward (its cursor becomes the next Evaluate's
  `since`), and HOLD parks at Deploy but is a full cycle, not a dead end.
- **Day 34 — the optional durable queue.** `RedisEventsBus` implements `IEventBus`
  at-least-once over a `StreamTransport` seam (Redis Streams / SQS semantics) with
  dead-letter + backoff; `EVENT_TRANSPORT=inproc|redis|sqs` with `inproc` the
  zero-config default, so the in-process bus stays the hot path.
- **Day 35 — the checkpoint.** `demo:closed-loop` upgraded to prove the milestone:
  a seeded window → PROMOTE, a forced no-improvement → HOLD, re-entry, and the
  human-gate assertion (below).

## The milestone, demonstrated

`pnpm demo:closed-loop` prints this shape (one run, three cycles):

```text
1. seeded window → fit → gate (PROMOTE):
   stages : evaluate=succeeded → calibrate=succeeded → deploy=succeeded → observe=succeeded
   outcome: completed   promoted: true   samples: 4

2. seeded window → fit → gate (HOLD — the guardrail):
   stages : evaluate=succeeded → calibrate=succeeded → deploy=held → observe=succeeded
   outcome: held   promoted: false

3. re-entry (second cycle feeds from the Observe cursor):
   outcome: completed   samples: 0

4. human gate: 15 events, 3 cycle ids, all learning.* ✅
   (APPROVE/REJECT decisions are inputs; AUTO_APPROVABLE is not consulted.)
```

The HOLD scene is the point: a no-improvement candidate parks at `deploy=held` and
*still* re-enters Evaluate. A loop that only ever promotes is unproven — the
guardrail is the feature, and it is exercised, not skipped.

## The human gate is untouched (the phase's moral core)

The loop's read-only relationship to human decisions is asserted, not assumed:

- Every event the cycle emits is `learning.stage_completed` / `learning.loop_completed`
  — no `review.*` event, so the loop never writes a decision.
- The seeded decisions (`wasUseful` usefulness verdicts + judge agreement) are
  snapshotted and asserted **byte-identical** after the run.
- `AUTO_APPROVABLE` (the sampled auto-path) is not consulted by the loop at all.

The correlation discipline from Day 33 makes this auditable: one `cycle_id` joins
the evaluation window → fitted candidate → deploy decision → observation, all
append-only in `event_log`.

## Durable transport: available, not gating the checkpoint

Per the plan's own §2.3, durability does **not** gate the milestone. The loop runs
on the in-process bus by default (`EVENT_TRANSPORT` unset → `inproc`); if a
deployment sets `redis`, the same `IEventBus` contract re-homes onto
`RedisEventsBus` with at-least-once + backoff + DLQ (proven standalone by
`demo:durable-queue` and `packages/event-bus/src/__tests__/durable.test.ts`). No
live broker ships in the repo — that path is compile-tested only, mirroring the
"no live keys" hygiene.

## The invariants, and what holds them

- **The boundary held.** The learning pipeline crosses into `@harness/evaluation`
  only at a *structural* seam (`CollectSeam`/`FitSeam`); `attention-engine` imports
  no evaluation package (boundary R4/R5). The architecture test stays green.
- **Automation stops at the gate.** `CalibrationJob` returns a `LearningRun`; it
  never applies a weight vector. `promoted` is an audit flag, not a mutation.
- **No live keys, no sandbox escape.** The demo is keyless and hermetic; the real
  Anthropic path and the real Redis path are compile-tested only.
- **Cardinality stays honest.** An empty window is a clean no-op (`candidate: null`),
  never a fit over zero rows.

## The debt carried forward

- **Adopting a promoted vector is still an explicit caller step.** The loop stops at
  "measured WIN"; nothing in the harness yet *applies* a promoted candidate to live
  routing. That is Week 8's call — and correctly so, since the corpus is small and a
  live flip should be its own gated action.
- **The measurement corpus is small.** HOLD-on-no-WIN over a handful of seeded facts
  is a demonstration, not a population. The flip decision belongs to the same
  measured A/B discipline that held Week 6's hybrid on INSUFFICIENT.
- **Week 8 hardens + exits** (Days 36–40): write-back idempotency, token redaction,
  multi-provider concurrency, then E2E + the exit review.

## Acceptance criteria

- [x] `pnpm demo:closed-loop` runs one full Evaluate → Calibrate → Deploy → Observe → Evaluate cycle.
- [x] All stages joined by one `learningCycleId` (`cycle_id` across every envelope).
- [x] A HOLD fixture parks at Deploy and still re-enters Evaluate.
- [x] The loop never mutates an APPROVE/REJECT decision (asserted: decisions unchanged, no `review.*`).
- [x] `pnpm test` + `pnpm lint` green (957 tests / 163 files).

---

*Next: [Day 36 — Hardening: Write-back Idempotency, Token Redaction, Multi-provider Concurrency](../plan/phase-3/day-36.md)*