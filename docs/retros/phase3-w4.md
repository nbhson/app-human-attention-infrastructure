# Phase 3 · Week 4 Retro — Review memory checkpoint

*Day-20 checkpoint (Phase 3, Week 4). Weeks 1–3 built the external-PR review slice,
verification, and the write-back seam; Week 4 asked whether the harness can **remember**.
The week delivered the four review-shaped memory tiers (`memory_entries` + the ≥1-evidence
provenance invariant, day-16), deterministic distillation (`MemoryDistiller`, day-17),
versioned, dedup-keyed append with confidence recurrence (`appendVersion`, day-17), the
event-bus ingestion pipeline (`MemoryIngestor`, day-17), the lexical+confidence+recency
+popularity relevance rank (`MemoryRetriever`, day-18), and the consolidate → decay →
archive lifecycle (`MemoryLifecycle`, day-19). The checkpoint wires them into one
end-to-end demo and closes the loop — **write a review outcome into memory, read it back
relevance-scored into the next review's context, then fold/fade/archive it.** Same rule
as every prior retro: honest by design, numbers-first, blameless, and green before
committed.*

---

## What held

- **The demo is a write→read round-trip through the real pipeline, not a store poke.**
  `pnpm demo:memory` emits the actual `review.report_created` domain event, lets the real
  `MemoryIngestor` → `MemoryDistiller` → `appendVersion` → `MemoryStore` chain persist the
  distilled entries, then reads them back with the real `MemoryRetriever` and injects them
  as a `memory` section on an assembled `ContextSnapshot` via `MemoryContextResolver`. No
  test double sidesteps the bus.
- **"Demonstrable" means the context changed, not that a table has rows.** The resolver
  appends `metadata.memory` (3 entries) to the snapshot, and the demo asserts the section
  is **non-empty** — a write-only store would fail this checkpoint even with a full table.
- **Relevance is auditable, not vibes.** Each retrieved row prints its score plus the
  signals behind it — lexical token coverage (`n/10`), `confidence` (the day-17 recurrence
  bump), age in days (recency), and `retrievedCount` (popularity). The top row is the
  CRITICAL finding (confidence 90, relevant tokens) beating the REVIEW and MAJOR entries
  on a query about *the same subject* — and the resolver's second `retrieve` nudges that
  same entry's score up as its popularity term ticks, visibly closing the feedback loop.
- **Every ingested entry cites ≥1 evidence.** Ingestion materializes one content-hashed
  `evidence` row (`LLM_TRANSCRIPT`) and links it to all three distilled entries; the demo
  asserts `sourceEvidence.length ≥ 1` on each, so the day-16 provenance invariant holds on
  the way *out*, not just on the way in.
- **The lifecycle is demonstrated live, and archived rows are actually excluded.** Re-ingesting
  the same report chains each subject onto itself; `consolidateChains` folds 3 chains
  (archiving 3 superseded rows, merging 3 evidence links). `applyDecay` drops a 30-day-stale
  entry 100 → 10 (its floor). `archiveBelowThreshold` soft-deletes a confidence-2 entry and
  the demo proves it vanishes from `listByKind` while `getById` still reaches it (audit).

## The W4 evidence (recorded demo output)

`pnpm demo:memory` (real ingestor + distiller + store + retriever + resolver, run against an
isolated `createTestDb('harness_demo_memory')` Postgres schema — no live key, no network):

```
=== 1 — write — emit review.report_created, ingest into grounded memory ===
  ingested 1 REVIEW + 2 FINDING entries:
    [REVIEW] Review of https://github.com/acme/api/pull/42
      confidence=50  evidence=1
    [FINDING] MAJOR in src/widget.ts: Unvalidated request body flows to the store
      confidence=70  evidence=1
    [FINDING] CRITICAL in src/widget.ts: Missing null check on user input
      confidence=90  evidence=1
  → every ingested entry cites ≥1 evidence row (the ≥1 provenance invariant).

=== 2 — read — retrieve top-K for a new review touching the same subject ===
  query: the widget endpoint payload needs a null guard before persisting
  top-K by relevance (signals: match / confidence / recency / popularity):
  kind       confidence  lexical      age(d)  retrieved  relevance  content
  FINDING        90      6/10         0.000         0      0.680  CRITICAL in src/widget.ts: Missing null check on
  REVIEW         50      7/10         0.000         0      0.650  Review of https://github.com/acme/api/pull/42
  FINDING        70      4/10         0.000         0      0.540  MAJOR in src/widget.ts: Unvalidated request body

  → relevance is auditable: the score + the signals behind it, not vibes.

  assembled context: 3 memory entry/ies injected as `metadata.memory` —
  [FINDING] conf=90 rel=0.690  CRITICAL in src/widget.ts: Missing null check on user input
  [REVIEW]  conf=50 rel=0.660  Review of https://github.com/acme/api/pull/42
  [FINDING] conf=70 rel=0.550  MAJOR in src/widget.ts: Unvalidated request body flows to the store

=== 3 — lifecycle·consolidate — re-ingest the same review, fold the chain ===
  re-ingest chained 3 version-chains; consolidate archived 3 superseded rows, folded 3 evidence links.
  → retrieval now surfaces only the chain head; the superseded row is audit-retained.

=== 4 — lifecycle·decay — an untouched entry fades to its confidence floor ===
  decay(now, factor 0.9/day): 100 → 10 (floor 10) after 30 days untouched; 3 fresh entries skipped (grace window).

=== 5 — lifecycle·archive — a below-threshold entry is soft-deleted, audit-retained ===
  archive: confidence 2 < threshold 5 → ARCHIVED; excluded from retrieval, reachable by id.

=== 6 — week-4 milestone — memory is closed (write + read + lifecycle) ===
  final active REVIEW entries: 2 (head + decayed-still-useful; superseded + forgotten archived).
  write ✓   event → ingest → 3 grounded entries, each ≥1 evidence.
  read  ✓   retrieve → top-K relevance-scored → memory section in context.
  life  ✓   consolidate + decay + archive all demonstrated live.
```

Acceptance criteria, one line each: `pnpm demo:memory` ingests a review and retrieves top-K
into a new review's context with a non-empty memory section; scores print with their signals;
consolidate + decay + archive are all demonstrated and archived rows are excluded from
retrieval; every ingested entry cites ≥1 evidence; `pnpm test && pnpm lint` green.

## What drifted (and how it was caught)

- **The write half of memory isn't bound at server boot yet — flagged, not papered over.**
  `MemoryStore`, `MemoryProvider`, `MemoryContextResolver`, and `MemoryLifecycle` are all
  registered in `buildContainer()`, but `MemoryIngestor.subscribe()` (the event → memory
  write path) is wired only by the demo and the `@harness/memory` suite, so a real
  `POST /api/reviews` does not yet distill into memory. This is the day-20 §6 "does top-K
  actually influence the reviewer?" gap surfacing one layer earlier: the *domain* is closed,
  the *server binding* is not. Called out in the wiring map (not silently skipped); binding
  that subscription is a later integration step.
- **The relevance rank needs no semantic shadow to be useful.** The lexical term alone
  already separates the CRITICAL finding (6/10 tokens, confidence 90) from the MAJOR (4/10,
  confidence 70) on a same-subject query, so the day-18 lexical baseline earns its keep; the
  semantic-shadow path (`SemanticRanker`) stays off the default resolve path until Day 21+
  calibration shows the keyword rank can be beaten.
- **Evidence is merged, never dropped, across a consolidate.** The head-of-chain fold uses
  the `memory_entry_evidence` UNIQUE index (`onConflictDoNothing`) and only *adds* links, so
  consolidation can't strip a head below the ≥1 invariant — the same rule that held on write
  holds across the lifecycle.

## Boundary check

- **`@harness/memory` stayed a shared-package leaf.** It imports only `@harness/domain`,
  `@harness/event-bus`, `@harness/db`, and `@harness/di` (never a sibling engine), while
  `@harness/context-engine` reaches it exclusively through the domain `MemoryProvider` seam
  (`MemoryContextResolver` lives in `context-engine`, not `memory`). The demo — an `apps/*`
  host — composes both, exactly where R5 permits it. The architecture test +
  `eslint-plugin-boundaries` stayed green.

---

*Checkpoint rule applied: `pnpm typecheck` (**48/48**), `pnpm lint`, and `pnpm test`
(**821** tests / **145** files) are all green before this note is committed. The demo runs
hermetically against an isolated Postgres schema, dropped on exit — no live API key, no
network, no shared database mutation.*

*Next: Day 21 — LLM-as-judge on Review Reports: Severity/Routing Rubric.
Memory is now stable — do not refactor it mid-phase; Week 5 pivots to review-quality calibration.*