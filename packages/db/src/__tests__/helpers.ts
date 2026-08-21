/**
 * Backwards-compatible re-export so `@harness/db`'s own tests keep importing
 * from `./__tests__/helpers.js`. The real implementation lives in
 * `../test-utils.js` (exported to workspace consumers as `@harness/db/test-utils`).
 */
export * from '../test-utils.js';
