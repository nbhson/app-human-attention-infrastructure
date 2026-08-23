/**
 * Context Engine (day-20) — collect, rank, and budget task context.
 *
 * Public surface:
 * - `types`     — `Tokenizer`, engine `ContextRequest`.
 * - `tiktoken-tokenizer` — exact `TiktokenTokenizer` (day-19) + `Tokenizer` impl.
 * - `tokenizer-registry`  — `getTokenizer(model)` per-model resolution (day-19).
 * - `tokenizer` — keyword `tokenize`, stopwords, `extractFileReferences`.
 * - `collect`   — `FileCollector` walks the root with hard exclusions.
 * - `rank`      — Phase-1 `relevanceScore` + `KeywordDependencyRanker`.
 * - `trim`      — token budget (`applyBudget`) + default policy.
 * - `engine`    — `ContextEngine.resolveContext` (scan → rank → trim → persist)
 *                 + `resolveFresh` (STALE re-resolve, day-21).
 * - `freshness` — `checkFreshness` + `sha256` (day-21).
 * - `render`    — `renderContextPrompt` structured prompt (day-21).
 * - `retrieval` — semantic retriever/ranker + shadow rank-comparison (day-18).
 * - `retrieval/retriever`      — the `Retriever` seam + `RetrievedDoc` (day-26).
 * - `retrieval/rrf`            — `reciprocalRankFusion` (k=60, day-26).
 * - `retrieval/hybrid-retriever` — lexical + semantic fused (day-26).
 * - `retrieval/retriever-factory` — `rank_method` → retriever resolver (day-26).
 * - `retrieval/query-rewriter` — RAG-Fusion variant generation (day-28).
 * - `retrieval/rag-fusion-retriever` — multi-query union + RRF (day-28).
 * - `ranking` — re-rank stage + dependency/recency/usage signals (day-27).
 * - `ranking/usage-learner` — usefulness → learned usage signal (day-32).
 * - `memory-resolver` — inject top-K review memory into a snapshot (day-18).
 */

export * from './types.js';
export * from './tiktoken-tokenizer.js';
export * from './tokenizer-registry.js';
export * from './tokenizer.js';
export * from './collect.js';
export * from './rank.js';
export * from './trim.js';
export * from './freshness.js';
export * from './render.js';
export * from './engine.js';
export * from './cache/context-cache.js';
export * from './cache/cache-invalidating-listener.js';
export * from './retrieval/semantic-retriever.js';
export * from './retrieval/semantic-ranker.js';
export * from './retrieval/shadow.js';
export * from './retrieval/retriever.js';
export * from './retrieval/rrf.js';
export * from './retrieval/lexical-retriever.js';
export * from './retrieval/semantic-doc-retriever.js';
export * from './retrieval/hybrid-retriever.js';
export * from './retrieval/retriever-factory.js';
export * from './retrieval/query-rewriter.js';
export * from './retrieval/rag-fusion-retriever.js';
export * from './ranking/signals.js';
export * from './ranking/re-ranker.js';
export * from './ranking/usage-learner.js';
export * from './memory-resolver.js';
