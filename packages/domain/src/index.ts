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

// Read-models.
export * from './provenance.js';
