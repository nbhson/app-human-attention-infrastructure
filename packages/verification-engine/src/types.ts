/**
 * Verification Engine core types (day-15 §2.1).
 *
 * The **Check abstraction** is the contract every check (compile now, test
 * Day 16, lint/type later) plugs into. A check is a read-only operation over the
 * agent's worktree that returns a {@link CheckResult}; the engine owns timeouts,
 * aggregation, persistence, and event publication — checks never do.
 */

import type { ChangeID, TaskID, VerificationResultID } from '@harness/domain';

/** The kinds of checks the engine can run (day-15 §3.1). */
export const CheckKind = {
  COMPILE: 'COMPILE',
  TEST: 'TEST',
  LINT: 'LINT',
} as const;
/** A check kind. */
export type CheckKind = (typeof CheckKind)[keyof typeof CheckKind];

/** The outcome of a single check (day-15 §2.1). */
export const CheckStatus = {
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  FLAKY: 'FLAKY',
  TIMED_OUT: 'TIMED_OUT',
  SKIPPED: 'SKIPPED',
} as const;
/** A per-check status. */
export type CheckStatus = (typeof CheckStatus)[keyof typeof CheckStatus];

/** The aggregate report verdict. A report is PASSED iff every check PASSED. */
export type OverallVerdict = 'PASSED' | 'FAILED';

/** The leaf outcome of one test inside a TEST check (day-16 §2.4). */
export interface ParsedTestResult {
  /** The test file's path (Vitest `assertionResults[].name`). */
  readonly testFile: string;
  /** The fully-qualified test name. */
  readonly testName: string;
  /** Per-test status, narrowed to the three persisted states. */
  readonly status: 'PASSED' | 'FAILED' | 'SKIPPED';
  /** Test duration in milliseconds. */
  readonly durationMs: number;
  /** Failure message + stack, truncated to 8 KB. */
  readonly error?: string;
}

/** The outcome of one check. */
export interface CheckResult {
  /** Which check produced this. */
  readonly checkKind: CheckKind;
  /** Per-check status. */
  readonly status: CheckStatus;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  /** Truncated stdout/stderr (64 KB cap). */
  readonly output: string;
  /** Set on Day 17 when the full output moves to evidence storage. */
  readonly evidenceId?: string;
  /** Day 17: the full, uncapped output — stored as `CHECK_OUTPUT` evidence. */
  readonly evidenceBody?: string;
  /** TEST check only (day-16): per-test leaf results persisted by the engine. */
  readonly testResults?: ParsedTestResult[];
  /** TEST check only (day-16): true when the flaky retry was exercised. */
  readonly retried?: boolean;
}

/** The environment a check runs against (day-15 §2.1). */
export interface CheckContext {
  /** The change under verification. */
  readonly changeId: ChangeID;
  /** The agent's dedicated branch/worktree — never the main checkout (§2.3). */
  readonly worktreePath: string;
  /** Where agent writes land (§5.5). */
  readonly sandboxRoot: string;
}

/** A single verification check: read-only, bounded by `timeoutMs` (level 1). */
export interface VerificationCheck {
  readonly kind: CheckKind;
  /** Per-check timeout in milliseconds. */
  readonly timeoutMs: number;
  run(ctx: CheckContext): Promise<CheckResult>;
}

/** The aggregated outcome of one verification run (day-15 §2.2). */
export interface VerificationReport {
  /** Reuses `VerificationResultID` — flows straight into `verification.completed`. */
  readonly id: VerificationResultID;
  readonly changeId: ChangeID;
  readonly taskId: TaskID;
  /** PASSED iff every check is PASSED or FLAKY. */
  readonly overall: OverallVerdict;
  readonly durationMs: number;
  readonly checks: CheckResult[];
  /** True when at least one check ran FLAKY (day-16 §2.2). */
  readonly flaky: boolean;
  /** Kinds of checks that did not pass (for REWORK rationale); excludes FLAKY. */
  readonly failedChecks: CheckKind[];
}
