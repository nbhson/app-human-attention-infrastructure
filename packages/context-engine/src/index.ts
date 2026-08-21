/**
 * Context Engine (day-20) — collect, rank, and budget task context.
 *
 * Public surface:
 * - `types`     — `Tokenizer`, `ApproxTokenizer`, engine `ContextRequest`.
 * - `tokenizer` — keyword `tokenize`, stopwords, `extractFileReferences`.
 * - `collect`   — `FileCollector` walks the root with hard exclusions.
 * - `rank`      — Phase-1 `relevanceScore` + `KeywordDependencyRanker`.
 * - `trim`      — token budget (`applyBudget`) + default policy.
 * - `engine`    — `ContextEngine.resolveContext` (scan → rank → trim → persist).
 */

export * from './types.js';
export * from './tokenizer.js';
export * from './collect.js';
export * from './rank.js';
export * from './trim.js';
export * from './engine.js';
