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
export { flagReport, FLAG_TAIL_LENGTH, tailOf } from './report-flag.js';
export type { FlaggedCheck, VerificationFlag } from './report-flag.js';
export { renderFlag } from './report-render.js';
export { CompileCheck } from './checks/compile-check.js';
export { TestCheck } from './checks/test-check.js';
export { SandboxedCheck } from './executors/sandboxed-check.js';
export type { SandboxedCheckOptions } from './executors/sandboxed-check.js';
export { CloneCompileCheck } from './clone-checks/compile-check.js';
export { CloneTestCheck } from './clone-checks/test-check.js';
export {
  parsePackageScripts,
  resolvePackageScripts,
  runScriptCheck,
  SandboxRunner,
  toCheckResult,
} from './sandbox-runner.js';
export type { PackageManager, PackageScripts, SandboxRunnerOptions } from './sandbox-runner.js';
export { CloneVerifier } from './clone-verifier.js';
export type {
  CloneVerifierOptions,
  CloneVerificationReport,
  CloneWorktree,
} from './clone-verifier.js';
