# Phase 4 — Memory & Context Improvement Register

Targets `@harness/memory` and `@harness/context-engine`. Both packages exit
Phase 3 at **v1.0-candidate** quality: heavily documented, deterministic, and
well-tested (99 unit tests across the two suites at last count, plus the
`render`/`lifecycle`/`retrieval`/`memory-resolver` coverage). This register is a
read of the *remaining* seams — each item is a measured, low-risk gap, not a
re-design.

## Findings

| # | Area | Observation | Verdict |
|---|------|-------------|---------|
| 1 | `context-engine/render.ts` | `MemoryContextResolver.inject` appends top-K memory as `metadata.memory`, but `renderContextPrompt` never renders it — injected review memory never reached the reviewer. | **Fixed** (below) |
| 2 | `memory/lifecycle/archive.ts` | `archiveBelowThreshold` issued **one `UPDATE` per stale row** (N round-trips). | **Fixed** (batched) |
| 3 | `memory/lifecycle/{decay,consolidate}.ts` | Per-row `UPDATE`s where each row's value is computed independently (can't be folded to a single constant). | Deferred — correctness first |
| 4 | `memory/memory-retriever.ts` | Lexical match scores `content` only; the stable `dedup_key` subject (already normalized into `content` for FINDING/DECISION) is not lexically weighted separately. | Deferred — marginal recall gain, higher regression risk |
| 5 | `context-engine/retrieval/query-rewriter.ts` | `withTimeout` race does not call `clearTimeout` on the fast path. | Deferred — timer is `unref()`d, no leak/resource cost |

## Implemented

### 1. Render the injected review-memory section (`context-engine`)

`render.ts` now reads `snapshot.metadata.memory` (the `{id, kind, content,
confidence, relevance}` array injected by `MemoryContextResolver`) and renders it
as a `## Review Memory` section between `## Task` and `## Relevant Files`:

```text
## Review Memory
- [DECISION] reject until verified (confidence: 80, relevance: 0.91)
```

- **Backward compatible.** Absent or malformed `metadata.memory` degrades to no
  section — rendering never fails on a missing seam.
- **Deterministic.** Pure layout, no LLM/IO; the budget is still enforced at
  trim time (this render only lays entries out).
- **Closed the loop** the README already claimed: injected memory now actually
  reaches the assembled prompt.
- Tests: `render.test.ts` asserts section ordering (Task < Review Memory <
  Files), exact entry formatting, absence when uninjected, and no-throw on a
  malformed section.

### 2. Batch the archive write (`memory`)

`archiveBelowThreshold` now writes every stale row in **one**
`UPDATE … WHERE id IN (…)`, then still publishes one `memory.archived` event per
row:

- **One round-trip** instead of one per row.
- **Provenance never merges** — the per-row audit events and debug logs are
  untouched; only the write folds.
- Tests: `lifecycle.test.ts` adds a multi-row case asserting both rows archive
  in one pass and each still emits its own `memory.archived` with
  `reason: below_confidence_threshold`.

## Not implemented (held, with reason)

- **Decay / consolidate batching (finding 3).** Each row's next value is computed
  independently (`confidence · factor^age`, chain-max fold), so a fold would
  require a per-row `CASE`/CTE with no correctness gain to justify the risk
  against the audited `lifecycle` suite. Left per-row deliberately.
- **Lexical subject weighting (finding 4).** The dedup subject is already folded
  into `content` at distillation, so weighting it again double-counts the same
  token stream. Any change would need a re-ranked baseline over the gold corpus
  before it could win the default — out of scope for a focused pass.
- **Timer hygiene in `withTimeout` (finding 5).** The timer is `unref()`d; the
  only cost is a stale pending timer until it fires, with no handle leak. Not
  worth a change without an observed issue.

## Verification

`pnpm test` (unit), `pnpm lint`, `pnpm typecheck`, and the package-scoped suites
for `@harness/context-engine` and `@harness/memory` are expected green; the two
changed suites were run first (`render.test.ts` 7/7, `lifecycle.test.ts` 9/9).