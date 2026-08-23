/**
 * `CloneTestCheck` (day-12 §3.1) — TEST over an external PR's clone.
 *
 * Runs the clone's **own** `test` script inside the Docker sandbox. Unlike the
 * in-process `TestCheck` (which drives Vitest's JSON reporter for per-test leaves
 * and applies the flaky retry rule), a clone's `test` is an arbitrary declared
 * command — its exit code is the only honest signal. Structured leaf parsing and
 * retry stay with the harness's own Vitest path; here we measure *the PR's*
 * runner, whatever it is (day-12 §2.2).
 */

import type { CheckResult } from '../types.js';
import { CheckKind } from '../types.js';
import { runScriptCheck } from '../sandbox-runner.js';
import type { SandboxRunner } from '../sandbox-runner.js';

/** The TEST half of clone verification, backed by a shared {@link SandboxRunner}. */
export class CloneTestCheck {
  readonly kind = CheckKind.TEST;

  constructor(private readonly runner: SandboxRunner) {}

  /** Run the clone's `test` script in the sandbox and map the outcome. */
  run(workdir: string): Promise<CheckResult> {
    return runScriptCheck(this.runner, CheckKind.TEST, 'test', workdir);
  }
}
