/**
 * Review memory (review-reorient Phase 3, day-16/17) — past reviews, findings, and
 * decisions distilled into searchable context for the next review.
 *
 * Public surface:
 * - `types`           — `CreateMemoryInput` + the `EmptySourceEvidenceError`.
 * - `memory-store`    — `MemoryStore` (`create`/`getById`/`listByKind`).
 * - `memory-distiller` — deterministic evidence → curated-candidate extraction.
 * - `versioned-append` — dedup-keyed, `supersedes`-chained append + confidence.
 * - `memory-ingestor`  — event-bus subscriber (`review.report_created` /
 *   `review.decision_submitted`) that grounds each entry in an evidence row.
 * - `chain-resolve`    — `resolveChainHeads` (supersede-chain → head, day-18).
 * - `memory-retriever` — lexical+confidence+recency relevance rank (day-18).
 * - `lifecycle/*`      — consolidate/decay/archive + the scheduled tick (day-19).
 */

export * from './types.js';
export * from './memory-store.js';
export * from './memory-distiller.js';
export * from './versioned-append.js';
export * from './memory-ingestor.js';
export * from './chain-resolve.js';
export * from './memory-retriever.js';
export * from './lifecycle/consolidate.js';
export * from './lifecycle/decay.js';
export * from './lifecycle/archive.js';
export * from './lifecycle/scheduler.js';
