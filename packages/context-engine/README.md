# @harness/context-engine — Context Assembly, Ranking & Caching

Builds the context the reviewer actually sees: exact tokenization, relevance
ranking (keyword default; hybrid + RAG Fusion built and selectable), freshness
gating, review-memory injection, and an invalidate-on-change cache.

**Status:** v1.0-candidate (Phase 3 as-built) — pending Day 40 exit review ·
**Boundary rule:** engine (R4) — imports only shared packages; consumes the embedder and
memory seams, never another engine.

---

## Purpose

1. **Collect** candidate sources for a review.
2. **Rank** them by relevance (keyword default; hybrid/RAG Fusion selectable via `rank_method`).
3. **Trim** to a token budget — exactly (`tiktoken`), not by estimate.
4. **Render** the final prompt context.
5. **Gate on freshness** — refuse to serve stale sources.
6. **Disambiguate identical pointers** — resolve a source path/line to one file.
7. **Inject review memory** — attach top-K memory as a `memory` section via the
   domain `MemoryProvider` seam.
8. **Cache** assembled context and invalidate on change.

## Pipeline

```text
                 task + repository
                        │
                        ▼
              ┌────────────────┐
              │  collect.ts    │  gather candidate source files
              └───────┬────────┘
                      ▼
              ┌────────────────┐
              │  fresh?        │──── no ──▶ freshness.ts flags stale
              └───────┬────────┘
                      ▼
              ┌────────────────┐
              │   rank.ts      │  KeywordDependencyRanker (default)
              │  ← RetrieverFactory(rank_method)  │  keyword | hybrid | rag_fusion
              └───────┬────────┘
                      ▼
              ┌────────────────┐
              │   trim.ts      │  budget-respecting truncation
              │ tiktoken       │  (exact token count)
              └───────┬────────┘
                      ▼
              ┌────────────────┐
              │   render.ts    │  final context string
              └───────┬────────┘
                      ▼
              resolveContext() → { prompt, sources, tokenCount }
```

## Tokenization — exact, not estimated

`tiktoken-tokenizer.ts` + `tokenizer-registry.ts` resolve the right tokenizer per
model, so `trim` stays under budget by construction — what the engine counts is
what the model will count.

## Ranking — keyword default, hybrid/RAG Fusion built

- **Default** (`rank.ts`, `KeywordDependencyRanker`) ranks by dependency proximity +
  keyword overlap.
- **Hybrid** (`retrieval/hybrid-retriever.ts`) fuses lexical + semantic results via
  `reciprocalRankFusion` (k=60) and re-ranks (`ranking/re-ranker.ts` +
  `ranking/signals.ts` with dependency / recency / learned-usage terms).
- **RAG Fusion** (`retrieval/rag-fusion-retriever.ts`) unions a query-rewriter's
  variants and re-fuses them — opt-in, never the default.

`RetrieverFactory.resolve(rank_method)` selects among them, but
`DEFAULT_RANK_METHOD` is **held at `keyword`** by the Day-29 A/B gate: the hybrid
arm reproduced the keyword order exactly over the replay corpus (no measured WIN),
so the default does not flip on a non-result. `hybrid` and `rag_fusion` remain
*selectable* per request; the semantic shadow (`retrieval/shadow.ts`) scores and
records `shadow_rank_comparisons` without affecting the hot path.

## Memory injection

`memory-resolver.ts` (`MemoryContextResolver`) asks the domain `MemoryProvider` seam
for top-K review memory and injects it as a `memory` section on a `ContextSnapshot`
(`metadata.memory`) — so this engine reads review memory without importing
`@harness/memory`. `render.ts` renders that section back into the final prompt as a
`## Review Memory` block (`- [kind] content (confidence, relevance)`) placed between
the `## Task` and `## Relevant Files` sections, so injected memory actually reaches
the reviewer. A missing or malformed `metadata.memory` degrades to no section —
rendering never fails on an absent seam.

## Cache

| Component | What it does |
| --- | --- |
| `cache/context-cache.ts` | `ContextCache` — reuse an assembled context while its sources are unchanged. |
| `cache/cache-invalidating-listener.ts` | Drops cache entries on `artifact.changed`. |

A hit is served only while the underlying artifacts are unchanged — invalidate-on-
change, never time-decayed.

## Modules

| Module | What it provides |
| --- | --- |
| `types.ts` | `Context`, `ContextChunk`, `TokenCount`, request/policy types. |
| `collect.ts` / `rank.ts` / `trim.ts` / `freshness.ts` / `render.ts` / `engine.ts` | the collect→rank→trim→render pipeline + `resolveContext` / `resolveFresh`. |
| `tiktoken-tokenizer.ts` / `tokenizer-registry.ts` / `tokenizer.ts` | exact tokenizer + model→tokenizer resolution + keyword tokenize. |
| `resolve-safe.ts` | safe path resolution. |
| `cache/*` | context cache + invalidation listener. |
| `retrieval/*` | semantic retriever/ranker/shadow, `Retriever` seam, RRF, lexical/semantic-doc/hybrid, `RetrieverFactory`, query-rewriter, RAG Fusion. |
| `ranking/*` | re-ranker + dependency/recency/usage signals + `UsageLearner` (learned usefulness). |
| `memory-resolver.ts` | inject top-K review memory into a snapshot. |

## Interaction with other packages

```text
      artifact-tracker ──(artifact.changed)──▶ context-engine (cache invalidation)
      @harness/embeddings ──(embedder seam)──▶ context-engine (semantic ranker)
      @harness/domain ──(MemoryProvider seam)──▶ context-engine (memory-resolver)
      agent-runtime ◀── context-engine (supplies the assembled context)
```

The engine never imports another engine. It consumes the embedder through the
retriever/ranker seam and review memory through the domain `MemoryProvider` seam.

## Key invariants

- **Exact tokens.** Budget is enforced on `tiktoken` counts, not word counts.
- **Freshness gating.** A stale source is flagged, never silently served.
- **Default is held, not inherited.** The keyword ranker stays the default until a
  measured WIN over a *live, outcome-measuring* comparison flips `DEFAULT_RANK_METHOD`.

## Directory structure

```
src/
├── index.ts
├── types.ts
├── collect.ts / rank.ts / trim.ts / freshness.ts / render.ts / engine.ts / resolve-safe.ts
├── tiktoken-tokenizer.ts / tokenizer-registry.ts / tokenizer.ts
├── cache/            # context-cache, cache-invalidating-listener
├── retrieval/        # retriever seam + semantic/lexical/hybrid/rag-fusion + rrf + factory + shadow
├── ranking/          # re-ranker, signals, usage-learner
└── memory-resolver.ts
```

## Public API surface

```typescript
// types: Context, ContextChunk, TokenCount, ContextSource, ContextSnapshot, ContextRequest, ContextPolicy
// engine: ContextEngine, resolveContext, resolveFresh
// tokenizer: tiktoken tokenizer + registry + seam
// ranker: KeywordDependencyRanker
// retrieval: Retriever, RetrievedDoc, reciprocalRankFusion, LexicalRetriever,
//            SemanticDocRetriever, HybridRetriever, RagFusionRetriever, RetrieverFactory,
//            RANK_METHOD_KEYWORD / _HYBRID / _RAG_FUSION, DEFAULT_RANK_METHOD
// ranking: re-ranker, signals, UsageLearner
// memory: MemoryContextResolver
// cache: ContextCache, cache-invalidating listener
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`; `TOKENS.Embedder` (stub by default) feeds
the semantic retriever. The `/context` route lives in `apps/api/src/routes/context.ts`.