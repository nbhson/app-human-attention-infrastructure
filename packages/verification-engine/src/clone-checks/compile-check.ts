/**
 * `CloneCompileCheck` (day-12 §3.1) — COMPILE over an external PR's clone.
 *
 * Runs the clone's **own** `build` script inside the Docker sandbox, rather than
 * the harness's hardcoded `tsc --noEmit` (which would measure *our* toolchain,
 * not the PR's declared build). The clone worktree is passed directly — not the
 * internal {@link CheckContext}, which carries an agent `ChangeID` an external PR
 * does not have (day-12 §2.1 note). The *result* contract (`CheckResult` /
 * `CheckKind` / `CheckStatus`) is the same one the engine already consumes.
 */

import type { CheckResult } from '../types.js';
import { CheckKind } from '../types.js';
import { runScriptCheck } from '../sandbox-runner.js';
import type { SandboxRunner } from '../sandbox-runner.js';

/** The COMPILE half of clone verification, backed by a shared {@link SandboxRunner}. */
export class CloneCompileCheck {
  readonly kind = CheckKind.COMPILE;

  constructor(private readonly runner: SandboxRunner) {}

  /** Run the clone's `build` script in the sandbox and map the outcome. */
  run(workdir: string): Promise<CheckResult> {
    return runScriptCheck(this.runner, CheckKind.COMPILE, 'build', workdir);
  }
}
