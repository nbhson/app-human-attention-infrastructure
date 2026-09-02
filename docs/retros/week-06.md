# Phase 2 · Week 6 Retro — Harden, A/B dry-run, and the Phase 2→3 exit

_Day-30 checkpoint (Phase 2). Week 6 was the hardening week that ended in the
exit review: failure injection + concurrency (Day 26), the full E2E under the
Phase-2 stack (Day 27), spec/doc bump (Day 28), and the keyword-vs-semantic A/B
dry-run (Day 29) that fed Day 30's go/no-go. Same rule as every prior retro:
honest by design, numbers-first, blameless — and green before committed._

---

## What held

- **The shadow discipline held all the way to the exit.** The single most
  load-bearing fact of the phase — semantic retrieval was _installed_ for three
  weeks and _never_ became the default — was re-proven at the end, not just
  asserted. `RANK_METHOD` resolves to `'phase1-keyword-dependency'`
  (`apps/context-engine/src/trim.ts:22`), `semanticShadowEnabled` defaults OFF
  (`types.ts:50`), and the shadow-negative test asserts the keyword path makes
  zero embedder calls. Day 29's dry-run then _used_ that shadow the right way:
  arm B's `semantic` ranking exists only in `ab_runs.report`, and the guardrail
  (live `tasks`/`decisions`/`contexts` unchanged) HELD.
- **The A/B harness caught a real disagreement, and refused to over-claim it.**
  On the two multi-file fixtures the ranks were exact reversals
  (`rank_correlation = [-1.0, -1.0]`): keyword surfaces the dependency-central
  target, semantic surfaces the content-rich helper. On outcome, both arms were
  identical (`acceptance 1.0`, `rework 0.0`) because a replayed trajectory's
  consumption is fixed. The recommendation — _"promote semantic ranking to a
  real A/B, collect live outcome data first"_ — is the honest answer, not a soft
  confirmation of the favorite. The dry-run was the canary; it proved the ranks
  differ, and it is deliberately **not** the verdict.
- **The safe defaults were left in place.** Auto-approve flag OFF at rest,
  kill-switch armed, semantic shadow OFF — the close-out check (§3.5) verified
  no subsystem drifted into a non-default state, which is exactly the silent
  config drift this phase was built to make impossible.

## What drifted (and how it was caught)

- **The weight fit did not earn the default — and nothing forced it to.**
  Week 3's finish was a hard checkpoint: fitted log-loss **0.316** vs the
  placeholder **0.262**, so `StaticWeightsAdapter` stayed. This is drift in the
  _aspiration_ ("calibrated weights by end of phase"), caught by the governance
  rule (`eval:fit` never auto-promotes a loss) rather than by a red build. The
  phase ends with "calibrated" as **△**, not ✓ — carried as backlog item 6.
- **The canonical A/B fixture was degenerate, and that was caught before it
  shipped as a finding.** The single-file `coding-run.json` produces a corpus with
  one candidate, so `rank_correlation` is uncomputable (<2 shared top-k items).
  Two multi-file fixtures (`auth-gateway-token-refresh.json`,
  `search-index-ranking.json`) were added so the comparison is non-degenerate;
  the harness honestly _skips_ the single-file tau rather than padding it to 0.

## What Phase 3 must watch

- **Escalation leakage is 1.0.** On the N=4 window every auto-approvable item
  later defected to `REWORK` — the worst end of the dial, and the reason the
  auto-approve path is effectively unusable today. Phase 3's closed loop (days
  31–35) is the subsystem that must move this number down; if it does not, the
  "learn and automate under guardrails" premise is unfunded. _This is the number
  to watch._
- **`rank_method` cutover is a knife-edge, not a flip.** The Day-29 result
  (full reversal at the ranking layer, toss-up at the outcome layer) means
  "hybrid as default" must be won on `rework_rate` under live top-k pressure —
  the exact comparison the dry-run could not make. Watch that the cutover gate
  is the A/B outcome, not ranking disagreement (backlog item 1).
- **The routing metrics will outgrow their baseline.** Precision 0.333 / recall
  0.5 are real but over N=4, and Phase 1 left no baseline to compare against.
  Phase 3 must commit to the numbers-checkpoint habit so the _next_ exit review
  has a real baseline (Finding 1, carried as backlog item 6 + §4.2 of
  `phase2-metrics.md`).

## Boundary check

- **No engine imported another, still.** Day 29's semantic ranker is a
  self-contained TF-cosine shadow copy — `@harness/evaluation` imports only
  `domain`/`db`/`di`/`observability` (R9 held), so neither an engine nor
  `@harness/embeddings` (R10) was touched. The architecture test stays green,
  and the `ab_runs.report` carries `rankMethod: 'semantic'` only in the isolated
  `ab_*` store.

---

_Checkpoint rule applied: `pnpm build`, `pnpm typecheck`, `pnpm lint`,
`pnpm test` (695 tests / 132 files), and `pnpm e2e` (happy-path + 8 failure
scenarios) are all green before this note is committed. The served `rank_method`
is `'phase1-keyword-dependency'`, `semanticShadowEnabled` is OFF, and the
auto-approve flag is OFF. Tag `v0.2.0-harness` cut on the reviewed commit._

_Prev: [Week-6 A/B dry-run results](week6-ab-results.md) · See also: [Phase-2 →
3 metrics checkpoint](phase2-metrics.md), Phase-3 backlog._
