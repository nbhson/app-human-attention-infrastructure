# Phase 3 · Week 6 Retro — The hybrid faces the gate, and the gate holds

*Day-30 checkpoint (Phase 3). The Week-6 milestone was written as "hybrid
default"; the discipline says a default earns that word only by **winning its
measured A/B**. Day 29 put hybrid in front of the gate over the shared replay
corpus, and the gate said **HOLD** — hybrid reproduces keyword there, the corpus
cannot separate them, and a non-result must not flip a default. So the week ends
**HOLD-verified**: the retrieval surface (Days 26–28) is real and exercised, the
cutover seam (Day 29) is a one-line, reversible config, and the default remains
`keyword` with `hybrid`/`rag_fusion` selectable. Numbers-first, blameless, green
before committed.*

## What shipped this week (Days 26–30)

- **Day 26 — the seam.** `Retriever`/`RetrievedDoc` (`matchedBy`), `LexicalRetriever`,
  `SemanticDocRetriever`, `HybridRetriever` (lexical ⊕ semantic, RRF `k=60`),
  `RetrieverFactory` (`rank_method` → retriever, default `keyword`).
- **Day 27 — the re-rank.** `DependencyProximityResolver` behind a DI seam,
  `NEUTRAL_SIGNAL = 0.5`, placeholder weights `{fusion:0.5, dependency:0.3,
  recency:0.1, usage:0.1}`, `ReRanker` (1:1, never widens).
- **Day 28 — the opt-in RAG fusion.** `LLMQueryRewriter` behind `LLMProvider`
  (variant cap 5, latency timeout, throws on empty) and `RagFusionRetriever`
  (multi-query union + RRF, single-query fallback).
- **Day 29 — the measured cutover.** `RankingDryRun` (`eval:ab-report`) runs
  `keyword` vs `hybrid` behind one `ContextRanker` seam; the honest answer was
  **HOLD** (see [`phase3-w6-cutover.md`](./phase3-w6-cutover.md) for the full
  numbers and the reasoning).
- **Day 30 — the checkpoint.** `demo-hybrid-default.ts`, the wiring-map note, and
  this retro — a **HOLD-verified** Week-6 outcome, per the plan's own §2.3.

## The measurement, and the checkpoint's answer

Day 29's A/B over the three replay fixtures printed this, verbatim (`pnpm
eval:ab-report`):

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

Day 30 validates that held state rather than manufacturing a WIN:

- `DEFAULT_RANK_METHOD = RANK_METHOD_KEYWORD` — the one resolved value that *is*
  the default.
- `resolve('hybrid')` and `resolve('rag_fusion')` return their fused retrievers;
  `resolve(undefined)` stays `keyword`.
- The kill-switch round-trip (`keyword` → `hybrid` → `keyword`) is proven by
  `pnpm demo:hybrid-default`, which runs the **real** `LexicalRetriever` +
  `HybridRetriever` (RRF) hermetically — only the embedder's cosine ranking is
  stubbed, so the fusion that the `both` provenance stamps is production code.

## The "shadow cleanup" was a verification, not a diff

The plan's §3.2 asked to retire hot-path shadow computation. Inspection showed
there was **none to remove**: the semantic shadow is already opt-in
(`ContextEngine.resolveWithShadow`, gated by `semanticShadowEnabled`), the app
host calls only `resolveContext` (keyword), and `RetrieverFactory` is
**build-only** — never wired into the engine's hot path. So "clean" is verified,
and the demo is the proof: the default path is lexical-only, and hybrid exists
only where a caller names it. Nothing was deleted that needed deleting, and the
wiring-map now records that held state (`rank_method = phase1-keyword-dependency`
on the hot path; the seam is the available cutover point, not the engine's source).

## The invariants, and what holds them

- **The boundary held.** Arm B is a self-contained shadow copy in `evaluation` —
  no `@harness/context-engine` (R9) and no `@harness/embeddings` (R10) import;
  `db`'s `AbRunReport.rankMethod` union carries `'hybrid'` provenance. The
  architecture test stays green.
- **No hot-path shadow residue.** The live path resolves one retriever from
  `rank_method`; the second ranking exists only behind `resolveWithShadow` (opt-in)
  and the offline `eval:*` harness.
- **The guardrail re-check holds.** Re-running `eval:ab-report` post-cutover
  reproduces the same verdict (INSUFFICIENT) with live `tasks`/`decisions`/
  `contexts` unchanged — arm B's ranking never reaches a served `ContextSnapshot`.
- **No live keys, no sandbox escape.** The demo is keyless and hermetic; the real
  Anthropic path remains compile-tested only.

## The debt carried forward

- **The corpus is the debt.** `top-k=5 ≥ |candidates|` on a replayed run means
  outcome cannot differ, so `rank_correlation` never disagrees — a *measurement*
  gap, not a finding. The default flips only when a **live** comparison, with real
  top-k pressure, moves `rework_rate` down on `context_acceptance_rate ≥` — never
  on a dry-run screen.
- **The default stays `keyword`** until that live WIN. `hybrid`/`rag_fusion`
  remain selectable; the flip is a one-line change with the A/B report as its
  audit trail.

## Acceptance criteria

- [x] Default `rank_method` resolves through the gated `DEFAULT_RANK_METHOD` (`keyword`, HOLD).
- [x] No hot-path shadow computation remains (verified: semantic shadow opt-in, factory build-only).
- [x] Kill-switch round-trip (`keyword` → `hybrid` → `keyword`) works (`demo:hybrid-default`).
- [x] Post-cutover guardrail re-check holds (INSUFFICIENT, guardrail HELD).
- [x] `docs/architecture/wiring-map.md` records the held `rank_method` default.
- [x] `pnpm test` + `pnpm lint` green.

---

*Next: Day 31 — Learning Pipeline: Review Decisions → Calibration Update (Automated)*