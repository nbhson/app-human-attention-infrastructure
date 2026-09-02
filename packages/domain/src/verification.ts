/**
 * Verification domain types.
 *
 * The Verification Engine independently validates AI-generated changes by
 * running compilation, tests, static analysis, and security scans. Source:
 * `7_Verification_Engine_v0.2.md` (§2, §5.6). Verification is intentionally
 * separate from generation to prevent bias.
 */

import type {
  ChangeID,
  EvidenceID,
  PolicyID,
  ProjectID,
  TaskID,
  VerificationRequestID,
  VerificationResultID,
} from './ids.js';

/** The kinds of checks the engine can run (verification spec §2.1). */
export const VerificationCheckType = {
  Compile: 'COMPILE',
  Test: 'TEST',
  Lint: 'LINT',
  TypeCheck: 'TYPE_CHECK',
  SecurityScan: 'SECURITY_SCAN',
  Coverage: 'COVERAGE',
  Custom: 'CUSTOM',
} as const;
/** A verification check type. */
export type VerificationCheckType = (typeof VerificationCheckType)[keyof typeof VerificationCheckType];

/** Overall verification status (verification spec §2.2). */
export const VerificationStatus = {
  Running: 'RUNNING',
  Passed: 'PASSED',
  Failed: 'FAILED',
  Error: 'ERROR',
  Timeout: 'TIMEOUT',
  Skipped: 'SKIPPED',
} as const;
/** An overall verification status. */
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

/** Per-check result status (verification spec §2.2). */
export const VerificationCheckResultStatus = {
  Passed: 'PASSED',
  Failed: 'FAILED',
  Error: 'ERROR',
  Skipped: 'SKIPPED',
} as const;
/** A per-check result status. */
export type VerificationCheckResultStatus =
  (typeof VerificationCheckResultStatus)[keyof typeof VerificationCheckResultStatus];

/** The severity of a verification error (verification spec §2.2). */
export const VerificationErrorSeverity = {
  Error: 'ERROR',
  Warning: 'WARNING',
  Info: 'INFO',
} as const;
/** A verification error severity. */
export type VerificationErrorSeverity = (typeof VerificationErrorSeverity)[keyof typeof VerificationErrorSeverity];

/** The scheduling priority of a verification request (spec §2.1). */
export const VerificationPriority = {
  Low: 'LOW',
  Medium: 'MEDIUM',
  High: 'HIGH',
} as const;
/** A verification request priority. */
export type VerificationPriority = (typeof VerificationPriority)[keyof typeof VerificationPriority];

/**
 * A single check to run (verification spec §2.1).
 */
export interface VerificationCheck {
  /** The check type. */
  readonly type: VerificationCheckType;
  /** The tool to run, e.g. `"tsc"`, `"vitest"`, `"eslint"`. */
  readonly tool: string;
  /** Whether this check participates. */
  readonly enabled: boolean;
  /** Tool-specific configuration. */
  readonly config: Record<string, unknown>;
}

/**
 * A single tool-level verification error (verification spec §2.2).
 */
export interface VerificationError {
  /** The file the error is in. */
  readonly file: string;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based column number. */
  readonly column: number;
  /** Error severity. */
  readonly severity: VerificationErrorSeverity;
  /** Human-readable message. */
  readonly message: string;
  /** The tool's error code. */
  readonly code: string;
}

/**
 * The outcome of one check (verification spec §2.2).
 *
 * Flaky tests (which pass on retry after an initial failure) are not a distinct
 * status: the result stays `PASSED`/`FAILED`/etc. and `flaky` is recorded as a
 * flag (mirrored in `metrics`) per §5.6.
 */
export interface VerificationCheckResult {
  /** The check type. */
  readonly type: VerificationCheckType;
  /** The tool that ran. */
  readonly tool: string;
  /** The result status. */
  readonly status: VerificationCheckResultStatus;
  /** Duration of this check in milliseconds. */
  readonly durationMs: number;
  /** Captured stdout/stderr. */
  readonly output: string;
  /** Tool-level errors. */
  readonly errors: VerificationError[];
  /** Structured metrics (e.g. flaky flag, coverage %, pass counts). */
  readonly metrics: Record<string, unknown>;
  /** True when the check passed only after a flaky-test retry (§5.6). */
  readonly flaky?: boolean;
}

/**
 * A verification request (verification spec §2.1).
 */
export interface VerificationRequest {
  /** Unique request id. */
  readonly id: VerificationRequestID;
  /** The task being verified. */
  readonly taskId: TaskID;
  /** The change under verification. */
  readonly changeId: ChangeID;
  /** Creation time. */
  readonly createdAt: Date;
  /** The checks to run. */
  readonly checks: VerificationCheck[];
  /** Request-level timeout in seconds. */
  readonly timeoutSeconds: number;
  /** Scheduling priority. */
  readonly priority: VerificationPriority;
}

/**
 * The aggregated outcome of a verification (verification spec §2.2).
 */
export interface VerificationResult {
  /** Unique result id. */
  readonly id: VerificationResultID;
  /** The request this answers. */
  readonly requestId: VerificationRequestID;
  /** The task verified. */
  readonly taskId: TaskID;
  /** Overall status. */
  readonly status: VerificationStatus;
  /** Per-check results. */
  readonly checks: VerificationCheckResult[];
  /** Structured summary. */
  readonly summary: string;
  /** Start time. */
  readonly startedAt: Date;
  /** Completion time. */
  readonly completedAt: Date;
  /** Total duration in milliseconds. */
  readonly totalDurationMs: number;
  /** Link to the stored evidence record. */
  readonly evidenceRef?: EvidenceID;
}

/**
 * The policy governing verification (verification spec §2.3).
 */
export interface VerificationPolicy {
  /** Policy id. */
  readonly id: PolicyID;
  /** The project this policy applies to. */
  readonly projectId: ProjectID;
  /** Checks that must pass for approval. */
  readonly requiredChecks: string[];
  /** Advisory checks. */
  readonly optionalChecks: string[];
  /** Stop on first failure. */
  readonly failFast: boolean;
  /** Request-level timeout in seconds. */
  readonly timeoutSeconds: number;
  /** Max retries before failing. */
  readonly maxRetries: number;
  /** Minimum coverage percentage. */
  readonly coverageThreshold: number;
  /** Permitted verification tools. */
  readonly allowedTools: string[];
}

/** Input for {@link createVerificationRequest}. */
export type CreateVerificationRequestInput = Omit<VerificationRequest, 'createdAt' | 'priority'> &
  Partial<Pick<VerificationRequest, 'createdAt' | 'priority'>>;

/**
 * Build a {@link VerificationRequest} defaulting priority to `MEDIUM`.
 */
export function createVerificationRequest(input: CreateVerificationRequestInput): VerificationRequest {
  return { createdAt: new Date(), priority: VerificationPriority.Medium, ...input };
}

/** Input for {@link createVerificationCheckResult}. */
export type CreateVerificationCheckResultInput = Omit<VerificationCheckResult, 'errors' | 'metrics'> &
  Partial<Pick<VerificationCheckResult, 'errors' | 'metrics' | 'flaky'>>;

/**
 * Build a {@link VerificationCheckResult} defaulting `errors`/`metrics` empty.
 */
export function createVerificationCheckResult(input: CreateVerificationCheckResultInput): VerificationCheckResult {
  return { errors: [], metrics: {}, ...input };
}

/**
 * Build a {@link VerificationError}.
 */
export function createVerificationError(input: VerificationError): VerificationError {
  return input;
}
