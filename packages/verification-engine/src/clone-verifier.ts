/**
 * `CloneVerifier` (day-12 §3.3) — the *execute* step of verification breadth.
 *
 * Turns a clone's checkout (`CloneWorktree`, produced by the provider clone seam
 * on Day 11) into an aggregated {@link CloneVerificationReport}: the clone's own
 * `build` (`COMPILE`) then `test` (`TEST`), each run in the Docker sandbox.
 *
 * Ordering is **fail-closed** (§2.4): COMPILE runs first, and a non-passing
 * COMPILE short-circuits TEST to `SKIPPED` — a build that cannot compile is never
 * allowed to smoke into a test run. The match to the engine's own `buildReport`
 * is deliberate (PASSED iff every check is PASSED or FLAKY; `failedChecks`
 * excludes FLAKY) so a later day can route this report straight into the
 * `verification.completed` event without re-deriving the verdict.
 */

import { computeWorkdirManifest } from '@harness/sandbox';

import { CloneCompileCheck } from './clone-checks/compile-check.js';
import { CloneTestCheck } from './clone-checks/test-check.js';
import { CheckKind, CheckStatus } from './types.js';
import type { CheckResult, OverallVerdict } from './types.js';

/**
 * The checkout a clone produced (day-11). Structurally identical to
 * `@harness/git-provider`'s `CloneResult`, but declared here so the verification
 * engine never imports a provider seam (boundary rule R4) — the app layer binds
 * a `CloneResult` to this shape by its structural match.
 */
export interface CloneWorktree {
  /** Path to the populated worktree at the PR's head SHA. */
  readonly workdir: string;
  /** The head SHA actually checked out (provenance for the report). */
  readonly headSha: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
}

/** Aggregated outcome of verifying a clone's own build + test (day-12 §3.3). */
export interface CloneVerificationReport {
  readonly workdir: string;
  readonly headSha: string;
  /** SHA-256 of the verified clone bytes (attributability, Spec 7 §5.5). */
  readonly contentHash: string;
  /** PASSED iff every check is PASSED (a clone check is never FLAKY). */
  readonly overall: OverallVerdict;
  readonly durationMs: number;
  readonly checks: CheckResult[];
  /** Kinds that *ran* and failed to pass (FAILED / TIMED_OUT — the report's
   * FAILED flag, Day 13). A `SKIPPED` check is "not run" (short-circuit, no
   * script, or sandbox down), so it is surfaced in `checks` but not here: a
   * suppressed test was never a failing test. */
  readonly failedChecks: CheckKind[];
}

/** The two sandboxed checks, injected so tests can substitute stubbed runners. */
export interface CloneVerifierOptions {
  readonly compile: CloneCompileCheck;
  readonly test: CloneTestCheck;
}

/** Orchestrates COMPILE → TEST over a clone worktree and assembles the report. */
export class CloneVerifier {
  constructor(private readonly options: CloneVerifierOptions) {}

  async verify(clone: CloneWorktree): Promise<CloneVerificationReport> {
    const started = Date.now();
    const manifest = await computeWorkdirManifest(clone.workdir);

    const compile = await this.options.compile.run(clone.workdir);
    // Fail-closed §2.4: a non-passing COMPILE short-circuits TEST — never run the
    // PR's test script against a change that did not even build.
    const test =
      compile.status === CheckStatus.PASSED
        ? await this.options.test.run(clone.workdir)
        : skippedCheck(CheckKind.TEST, 'skipped: compile did not pass');

    const checks = [compile, test];
    return {
      workdir: clone.workdir,
      headSha: clone.headSha,
      contentHash: manifest.contentHash,
      overall: overallOf(checks),
      durationMs: Date.now() - started,
      checks,
      failedChecks: failedKinds(checks),
    };
  }
}

/** A `SKIPPED` check result used when fail-closed ordering suppresses a check. */
function skippedCheck(kind: CheckKind, note: string): CheckResult {
  return { checkKind: kind, status: CheckStatus.SKIPPED, durationMs: 0, output: note };
}

/** PASSED iff every check is PASSED or FLAKY (mirrors the engine's `buildReport`). */
function overallOf(checks: CheckResult[]): OverallVerdict {
  return checks.every((check) => check.status === CheckStatus.PASSED || check.status === CheckStatus.FLAKY)
    ? 'PASSED'
    : 'FAILED';
}

/**
 * Kinds that ran and failed to pass, excluding `FLAKY` (a flaky check counts as
 * passed-but-flagged) and — deliberately diverging from the engine's
 * `buildReport` — excluding `SKIPPED`. In the fail-closed clone sequence a
 * `SKIPPED` check was *suppressed* (short-circuit / no script / infra down), so
 * listing it under `failedChecks` would read as a test failure that never ran.
 */
function failedKinds(checks: CheckResult[]): CheckKind[] {
  return checks
    .filter((check) => check.status === CheckStatus.FAILED || check.status === CheckStatus.TIMED_OUT)
    .map((check) => check.checkKind);
}
