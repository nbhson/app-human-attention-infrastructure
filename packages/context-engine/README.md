# @harness/context-engine — Context Assembly, Ranking & Caching

Builds the context the agent and reviewer actually see: exact tokenization,
relevance-ranked dependencies, freshness gating, and an invalidate-on-change cache.

**Status:** Phase 1 + semantic retrieval (shadow) + cache (Phase 2) complete (as-built) ·
**Boundary rule:** engine — imports only shared packages; consumes the embedder seam from `@harness/embeddings`.

---

## Purpose

1. **Collect** candidate sources for a task.
2. **Rank** them by relevance (dependency proximity + keyword overlap; semantic in shadow).
3. **Trim** to a token budget — exactly, not by estimate.
4. **Render** the final prompt context.
5. **Gate on freshness** — refuse to serve stale sources.
6. **Cache** assembled context and invalidate on change.

---

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
              │   rank.ts      │  KeywordDependencyRanker
              │  (keyword)     │  ↕ shadow comparison
              │  semantic-ranker (shadow)│
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

---

## Tokenization — exact, not estimated

The Phase-1 trimmer was a word-count estimate; Day 19 replaced it with the real
`tiktoken` tokenizer. `tiktoken-tokenizer.ts` + `tokenizer-registry.ts` resolve
the right tokenizer per model, so `trim` stays under budget by construction —
what the engine counts is what the model will count.

---

## Ranking & semantic shadow

- **Default ranker** (`rank.ts`, `KeywordDependencyRanker`) ranks by dependency
  proximity + keyword overlap.
- **Semantic ranker** (`retrieval/semantic-ranker.ts`) ranks by embeddings from
  `@harness/embeddings`. It runs in **shadow** (`retrieval/shadow.ts`): it scores
  and records a `shadow-rank-comparisons` row, but `rank_method` stays `keyword`
  until a measured A/B win flips it.

---

## Cache

| Component | What it does |
| --- | --- |
| `cache/context-cache.ts` | `ContextCache` — reuse an assembled context while its sources are unchanged. |
| `cache/cache-invalidating-listener.ts` | Drops cache entries on `artifact.changed`. |

A hit is served only while the underlying artifacts are unchanged — the cache is
invalidate-on-change, never time-decayed.

---

## Modules

| Module | What it provides |
| --- | --- |
| `types.ts` | `Context`, `ContextChunk`, `TokenCount`, request/policy types. |
| `collect.ts` | Candidate source-file collection. |
| `rank.ts` | `KeywordDependencyRanker`. |
| `trim.ts` | Budget-respecting truncation. |
| `freshness.ts` | Source freshness gating. |
| `render.ts` | Final context rendering. |
| `engine.ts` | `resolveContext` / `resolveFresh`. |
| `tiktoken-tokenizer.ts` | Exact tokenizer. |
| `tokenizer-registry.ts` | Model → tokenizer resolution. |
| `tokenizer.ts` | The tokenizer seam. |
| `resolve-safe.ts` | Safe path resolution. |
| `cache/context-cache.ts` | Context cache + TTL. |
| `cache/cache-invalidating-listener.ts` | Invalidate on `artifact.changed`. |
| `retrieval/semantic-retriever.ts` | Embedding-backed retriever. |
| `retrieval/semantic-ranker.ts` | Embedding-backed ranking. |
| `retrieval/shadow.ts` | Keyword-vs-semantic shadow comparison. |

---

## Interaction with other packages

```text
      artifact-tracker ──(artifact.changed)──▶ context-engine (cache invalidation)
      @harness/embeddings ──(embedder seam)──▶ context-engine (semantic ranker)
      agent-runtime ◀── context-engine (supplies the assembled context)
```

The engine never imports another engine. It consumes the embedder through the
retriever/ranker seam; the agent runtime receives context upstream through the
orchestrator, not by importing this package.

---

## Key invariants

- **Exact tokens.** Budget is enforced on `tiktoken` counts, not word counts.
- **Freshness gating.** A stale source is flagged, never silently served.
- **Shadow-then-default.** The semantic ranker ships in shadow; only a measured
  win flips `rank_method`.

---

## Directory structure

```
src/
├── index.ts
├── types.ts
├── collect.ts / rank.ts / trim.ts / freshness.ts / render.ts
├── engine.ts
├── tiktoken-tokenizer.ts / tokenizer-registry.ts / tokenizer.ts / resolve-safe.ts
├── cache/            # context-cache, cache-invalidating-listener
└── retrieval/        # semantic-retriever, semantic-ranker, shadow
```

## Public API surface

```typescript
// types: Context, ContextChunk, TokenCount, ContextSource, ContextSnapshot, ContextRequest, ContextPolicy
// engine: resolveContext, resolveFresh
// tokenizer: tiktoken tokenizer + registry + seam
// ranker: KeywordDependencyRanker
// cache: ContextCache, cacheTTL, cache-invalidating listener
// retrieval: SemanticRetriever, SemanticRanker, shadow comparison
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`; `TOKENS.Embedder` (stub by default)
feeds the semantic retriever. The `/context` route lives in
`apps/api/src/routes/context.ts`.