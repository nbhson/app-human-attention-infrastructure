/**
 * `@harness/domain` — the single source of truth for all shared domain types.
 *
 * Every other package depends on this one; nothing here may import from another
 * `@harness/*` package. Re-exports are grouped by submodule.
 */

// Identifiers & primitives.
export * from './ids.js';
export * from './result.js';

// Execution & artifact model.
export * from './agent-run.js';
export * from './task.js';
export * from './artifact.js';
export * from './context.js';

// Trust pipeline.
export * from './verification.js';
export * from './attention.js';
export * from './review.js';

// Identity model (Phase 2 day-01).
export * from './identity.js';
export * from './actor-context.js';

// Read-models.
export * from './provenance.js';

// External integration model (review-reorient Phase 3).
export * from './integration.js';
export * from './review-report.js';
export * from './review-decision.js';
export * from './writeback.js';
export * from './writeback-store.js';
export * from './memory.js';

// The LLM call seam (day-21 §2.4): a pure contract so the review-quality judge
// can call the model without importing a sibling engine. Implementations live in
// `@harness/agent-runtime`; this package holds only the types.
export * from './llm.js';

// The review-quality judge port (day-21): JudgeScores / JudgeRun / JudgeRunStore.
export * from './judge.js';

// Events.
export * from './events/index.js';
