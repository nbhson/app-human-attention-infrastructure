# Phase 3 · Week 6 Cutover — hybrid faces the gate, and the gate holds

_Day-29 checkpoint (Phase 3). The Day-26/27/28 retrieval work — hybrid
(`HybridRetriever`, lexical ⊕ semantic fused by RRF, then re-ranked) behind the
single `Retriever` seam — is finally put in front of the measured A/B gate that
every default must clear before it ships. The verdict is **HOLD**: the default
`rank_method` stays `keyword`, hybrid remains *selectable* per request, and the
one-line cutover seam is documented, reversible, and — as the plan demands —
did **not** flip without a measured WIN._

## What shipped this week (Days 26–28) — the retrieval surface

- **Day 26 — the seam.** `Retriever` / `RetrievedDoc` (`matchedBy`:
  `lexical`/`semantic`/`both`); `LexicalRetriever` (keyword, sync) and
  `SemanticDocRetriever` (DB + embedder) adapt the two Phase-2 retrievers to one
  interface; `HybridRetriever` fuses both concurrently; `reciprocalRankFusion`
  (k=60); `RetrieverFactory` resolves `rank_method` (default `keyword`).
- **Day 27 — the re-rank.** `DependencyProximityResolver` behind a DI seam,
  `NEUTRAL_SIGNAL = 0.5`, placeholder weights `{fusion:0.5, dependency:0.3,
recency:0.1, usage:0.1}`, and `ReRanker` (1:1 re-order, never widens).
- **Day 28 — the opt-in RAG fusion.** `LLMQueryRewriter` behind `LLMProvider`
  (variant cap 5, latency timeout, throws on empty) and `RagFusionRetriever`
  (multi-query union + RRF, graceful single-query fallback).

## Day 29 — the measurement, and the honest answer

`RankingDryRun` (the `eval:ab-report` harness) now runs A = **keyword** vs B =
**hybrid** behind the shared `ContextRanker` seam. Both arms are self-contained
**shadow copies** (the `evaluation` package may not import an engine, boundary
R9): the keyword arm mirrors `context-engine/rank.ts`, and the hybrid arm mirrors
the Day-26/27 path — it shadows `reciprocalRankFusion` over the keyword + the
term-frequency-cosine semantic layer, then re-ranks with the
`0.5·fusion + 0.3·dependency` blend (recency/usage are absent on a replayed
trajectory, so each contributes the neutral `0.5` — a constant that drops out of
the ordering).

The default run (N=3, top-k=5) over the shared replay corpus:

```text
outcome signals (per arm):
  A keyword:   context_acceptance_rate=1.0000  human_minutes_per_accept=0.494  rework_rate=0.0000
  B hybrid:    context_acceptance_rate=1.0000  human_minutes_per_accept=0.494  rework_rate=0.0000

rank_correlation (hybrid vs keyword, top-k=5): [1.000, 1.000]
  count=2  min=1.000  max=1.000  mean=1.000

evidence:      INSUFFICIENT
  - rank_correlation disagreement 0% below the 50% bar
guardrail:     HELD (tasks/decisions/contexts unchanged)
recommendation: keep hybrid ranking in shadow — insufficient evidence
decision:      HOLD
```

## What the numbers mean — and why HOLD is the only correct answer

Three facts, read together:

1. **Hybrid _agrees_ with keyword over this corpus** (`tau = 1.0` on every
   computable input). The Phase-2 semantic-shadow run (`week6-ab-results.md`)
   found the two layers _exact reversals_ (`tau = -1`): semantic surfaces the
   content-rich helper, keyword surfaces the dependency-central target. Hybrid's
   re-rank closes that gap — its dependency signal (target = 1.0 vs helper =
   0.1) restores the target to the top, reproducing keyword's order on fixtures
   whose target is dependency-central. The fusion is not broken; it is _doing the
   re-rank's job_.

2. **The replay corpus is under-powered to separate them.** Two of the three
   fixtures are multi-file, but neither makes a consumed file leave one arm's
   top-5 while staying in the other's, so acceptance is `1.0` and rework `0.0`
   for _both_ arms — a replayed run's consumed files are fixed by the record.
   With `top-k=5 ≥ |candidates|`, outcome cannot differ, so `rank_correlation`
   never disagrees. That is a **measurement gap**, not a finding.

3. **Under the plan's gate, a non-result is a HOLD, not a flip.** §6 is explicit:
   if the corpus can't produce a clean verdict, the answer is _HOLD + fix the
   measurement_ — never "flip and see". The harness emits `keep-shadow` with its
   reason trace, and the default does not move.

## The gate, made explicit and reversible

The cutover is one resolved value, not a rewrite. `RetrieverFactory` now exposes

```ts
export const DEFAULT_RANK_METHOD: RankMethod = RANK_METHOD_KEYWORD;
```

`resolve(undefined)` routes through it; an explicit `rank_method` still reaches
`keyword` / `hybrid` / `rag_fusion` (each degrading to `keyword` when its
dependency is absent). Flipping the default to `hybrid`, when a live A/B wins on
the pre-agreed primary metric (**rework down, context acceptance ≥**), is a
one-line change with the A/B report + this decision as its audit trail. The
docstring records _why_ it is `keyword` today, so the next person does not need to
reverse-engineer the gate.

## The invariants, and what holds them

- **Arm B never reached a served snapshot.** Enforced twice: by construction
  (`RankingDryRun` holds a `ReadonlyDb` — no `insert`/`update`/`delete` on the
  type — plus an `AbStore` that writes only `ab_*`), and by the before/after
  live-count assertion that throws on any movement. The integration test seeds a
  fresh schema and asserts `tasks`/`decisions`/`contexts` stay at `0` while every
  `ab_runs.report` carries `rankMethod: 'hybrid'`. Held.
- **Vary one thing.** Both arms share the tokenizer, the corpus, the top-k, and
  target-preservation; only the rank function differs. `ranking-variants.test.ts`
  proves the mechanism both ways — the arms deterministically reorder a pure
  corpus, and a new case shows hybrid _re-ranks_ keyword (dependency restores a
  target keyword under-ranked) so the hybrid seam is a real, exercised function,
  not a pass-through.
- **No boundary was crossed.** The hybrid arm is a shadow copy — no
  `@harness/context-engine` (R9) and no `@harness/embeddings` (R10) import enters
  `evaluation`. `db`'s `AbRunReport.rankMethod` union was widened to carry
  `'hybrid'` provenance; the architecture test stays green.

## Decisions / debts carried forward

- **Default stays `keyword`.** Hybrid and `rag_fusion` remain _selectable_ for a
  live, outcome-measuring A/B; neither ships as the default until it wins there.
- **The corpus is the debt.** The next comparison must run where top-k pressure
  actually bites — real traffic with enough candidates that a consumed file can
  miss one arm's top-k and not the other's. That is what turns this HOLD into a
  measured WIN (or a measured rejection).
- **The dry-run is the cheap screen, never the verdict.** `rank_correlation` is
  the canary; the default flips only on `rework_rate` / `context_acceptance_rate`
  filling in under live pressure.

---

_Checkpoint rule applied: `pnpm lint`, `pnpm typecheck`, and `pnpm test` are
green; the `eval:ab-report` numbers above reproduce verbatim from the isolated
`ab_*` tables via `--run`, with the guardrail HELD. The served default remains
`keyword`; arm B's `hybrid` ranking exists only in `ab_runs.report`._
