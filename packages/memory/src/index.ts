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
 */

export * from './types.js';
export * from './memory-store.js';
export * from './memory-distiller.js';
export * from './versioned-append.js';
export * from './memory-ingestor.js';
