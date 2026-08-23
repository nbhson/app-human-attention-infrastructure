/**
 * `report-flag` (day-13 §2) — turn check outcomes into a **flag**, never a gate.
 *
 * A red verification is information, not authority. This module derives a
 * {@link VerificationFlag} from a flat `CheckResult[]` that a report, the web UI,
 * or a downstream notifier can render as "tests FAILED — see evidence". The flag
 * is a *pure read*: it holds no decision field, mutates nothing, and publishes
 * nothing. The load-bearing invariant (§6) — FAILED is reported and evidence is
 * preserved, but the human decision gate is untouched — is the *consumer's*
 * contract (see `@harness/artifact-tracker`'s `ChangeStatusSubscriber`, which
 * returns early on a FAILED `verification.completed`). This module simply refuses
 * to smuggle a decision into the data.
 *
 * Two honest distinctions the flag must not collapse:
 *
 *  - **TIMED_OUT vs FAILED** (§2.3). A container kill is *infra* (a slow CI is not
 *    a broken PR); a non-zero exit is *code*. They are surfaced side by side under
 *    `timedOutKinds` / `failedKinds` and `FlaggedCheck.status`, never merged into
 *    one undifferentiated "red".
 *  - **Evidence as ref + tail, not inline blob** (§2.2). The full output lives in
 *    the append-only evidence store (`CheckResult.evidenceId`, day-17); the flag
 *    carries only the id and a short truncated *tail* to judge at a glance.
 */

import { CheckStatus } from './types.js';
import type { CheckKind, CheckResult, OverallVerdict } from './types.js';

/** The statuses that make a check flag-worthy: it ran and did not pass. */
const FLAG_WORTHY = [CheckStatus.FAILED, CheckStatus.TIMED_OUT] as const;

/** Length of the output tail carried on a flag (never the full blob, §2.2). */
export const FLAG_TAIL_LENGTH = 1024;

/** A check that ran and failed to pass, with its evidence ref + preview tail. */
export interface FlaggedCheck {
  readonly kind: CheckKind;
  /** Narrowed to FAILED (code) or TIMED_OUT (infra), the two flag-worthy states. */
  readonly status: CheckStatus;
  /** Raw process exit code; `137` for a container kill. Absent on in-process checks. */
  readonly exitCode?: number;
  /** Evidence-store id the full output is persisted under (day-17). */
  readonly evidenceRef?: string;
  /** Truncated trailing preview of the output — enough to judge, never the blob. */
  readonly tail: string;
}

/**
 * The honest "did this verification fail, and why" summary (day-13 §2.2).
 *
 * A non-passing result yields `failed: true` and `verdict: 'FAILED'`; the flag is
 * still *descriptive* — whatever consumes it decides whether a FAILED verification
 * blocks, routes to `REWORK`, or merely annotates the review.
 */
export interface VerificationFlag {
  /** PASSED iff every check is PASSED or FLAKY. */
  readonly verdict: OverallVerdict;
  /** Convenience alias: `verdict === 'FAILED'` — the visible "red" signal. */
  readonly failed: boolean;
  /** Kinds that timed out (infra), distinct from code failures (§2.3). */
  readonly timedOutKinds: CheckKind[];
  /** Kinds that failed on their own (code), distinct from infra timeouts. */
  readonly failedKinds: CheckKind[];
  /** The flag-worthy checks (FAILED / TIMED_OUT) with evidence refs + tails. */
  readonly failedChecks: FlaggedCheck[];
}

/** A short trailing preview of an output, for the report (never the full blob). */
export function tailOf(output: string, max = FLAG_TAIL_LENGTH): string {
  if (output.length <= max) {
    return output;
  }
  return `…[earlier output truncated]\n${output.slice(output.length - max)}`;
}

/**
 * Assemble the FAILED flag from a set of check results.
 *
 * `SKIPPED` is deliberately excluded everywhere: a suppressed check (short-circuit,
 * no declared script, or sandbox down) was *not run*, so it must not read as a
 * failure. Only a check that ran and failed to pass is flag-worthy.
 */
export function flagReport(checks: readonly CheckResult[]): VerificationFlag {
  const failed = checks.some((check) =>
    (FLAG_WORTHY as readonly CheckStatus[]).includes(check.status),
  );
  const flagged = checks.filter((check) =>
    (FLAG_WORTHY as readonly CheckStatus[]).includes(check.status),
  );
  return {
    verdict: failed ? 'FAILED' : 'PASSED',
    failed,
    timedOutKinds: checks
      .filter((check) => check.status === CheckStatus.TIMED_OUT)
      .map((check) => check.checkKind),
    failedKinds: checks
      .filter((check) => check.status === CheckStatus.FAILED)
      .map((check) => check.checkKind),
    failedChecks: flagged.map((check) => ({
      kind: check.checkKind,
      status: check.status,
      ...(check.exitCode === undefined ? {} : { exitCode: check.exitCode }),
      ...(check.evidenceId === undefined ? {} : { evidenceRef: check.evidenceId }),
      tail: tailOf(check.output),
    })),
  };
}
