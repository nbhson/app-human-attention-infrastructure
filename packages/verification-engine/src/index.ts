/**
 * `@harness/verification-engine` — the independent validator (day-15).
 *
 * Runs compile/test/lint checks over an agent's change and publishes
 * `verification.completed`. Imports only the shared packages (domain, event-bus,
 * db) — never a sibling engine (boundary rule R4).
 */

export * from './types.js';
export * from './timeout.js';
export * from './env.js';
export * from './parse-vitest-json.js';
export * from './evidence-store.js';
export * from './verification-engine.js';
export { CompileCheck } from './checks/compile-check.js';
export { TestCheck } from './checks/test-check.js';
