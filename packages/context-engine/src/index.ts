/**
 * Context Engine (day-20) — collect, rank, and budget task context.
 *
 * Public surface:
 * - `types`     — `Tokenizer`, `ApproxTokenizer`, engine `ContextRequest`.
 * - `tokenizer` — keyword `tokenize`, stopwords, `extractFileReferences`.
 * - `collect`   — `FileCollector` walks the root with hard exclusions.
 * - `rank`      — Phase-1 `relevanceScore` + `KeywordDependencyRanker`.
 * - `trim`      — token budget (`applyBudget`) + default policy.
 * - `engine`    — `ContextEngine.resolveContext` (scan → rank → trim → persist)
 *                 + `resolveFresh` (STALE re-resolve, day-21).
 * - `freshness` — `checkFreshness` + `sha256` (day-21).
 * - `render`    — `renderContextPrompt` structured prompt (day-21).
 */

export * from './types.js';
export * from './tokenizer.js';
export * from './collect.js';
export * from './rank.js';
export * from './trim.js';
export * from './freshness.js';
export * from './render.js';
export * from './engine.js';
