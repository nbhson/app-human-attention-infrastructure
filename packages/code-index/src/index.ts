/**
 * `@harness/code-index` (day-14) — the dependency-graph leaf that feeds *targeted*
 * verification.
 *
 * Given the PR's changed files, build a symbol + dependency index of the clone and
 * compute the transitive set of affected tests, so Day 15+ can run fewer tests
 * without changing the verdict. The correctness guarantee is the fallback: when
 * the graph is incomplete (a dynamic import, a bare package, an unparsed file),
 * the consumer falls back to the full suite rather than guess.
 *
 * Pure leaf (node built-ins only) per boundary R4 — verification-engine consumes
 * it through the `AffectedTestsResolver` seam, never a direct import.
 */

export * from './indexer.js';
export * from './graph.js';
export * from './affected.js';
export * from './proximity.js';
