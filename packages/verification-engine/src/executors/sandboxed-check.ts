/**
 * `SandboxedCheck` (day-22 §3.3) — runs a check inside the {@link Sandbox} and
 * maps the result back into the engine's {@link CheckResult} vocabulary.
 *
 * The independence that matters (verification ≠ generation) becomes structural
 * here: the check no longer shares a process with the agent. The sandbox runs
 * one command over the worktree and reports exit code + capped output; this
 * adapter maps that to PASSED/FAILED/TIMED_OUT.
 *
 * Failure discipline (§2.4): a {@link SandboxInfraError} (daemon down, image
 * missing) is *not* a check verdict — it routes to the injected in-process
 * fallback with a logged warning, so verification degrades rather than dies and
 * never records a false `FAILED` for infra trouble.
 */

import type { Logger } from '@harness/di';
import { SandboxInfraError, computeWorkdirManifest } from '@harness/sandbox';
import type { Sandbox, SandboxLimits, SandboxResult } from '@harness/sandbox';

import { truncateOutput } from '../env.js';
import type { CheckContext, CheckResult, VerificationCheck } from '../types.js';
import { CheckStatus } from '../types.js';

export interface SandboxedCheckOptions {
  /** The in-process fallback run when the sandbox is unavailable. */
  readonly inner: VerificationCheck;
  /** The isolation runtime. */
  readonly sandbox: Sandbox;
  /** The pinned image the command runs inside. */
  readonly image: string;
  /** Build the container command line from the check context (image-specific). */
  readonly buildCommand: (ctx: CheckContext) => string[];
  /** Resource + time budgets (the timeout is derived from `inner.timeoutMs`). */
  readonly limits: SandboxLimits;
  /** Writes the fallback warning (§2.4: degradation must be loud). */
  readonly logger?: Logger;
}

/** A compile-oriented sandboxed check: single run, exit code → status. */
export class SandboxedCheck implements VerificationCheck {
  readonly kind: VerificationCheck['kind'];
  readonly timeoutMs: number;

  constructor(private readonly options: SandboxedCheckOptions) {
    this.kind = options.inner.kind;
    this.timeoutMs = options.inner.timeoutMs;
  }

  async run(ctx: CheckContext): Promise<CheckResult> {
    let result: SandboxResult;
    try {
      const manifest = await computeWorkdirManifest(ctx.worktreePath);
      result = await this.options.sandbox.run({
        command: this.options.buildCommand(ctx),
        image: this.options.image,
        workdirPath: ctx.worktreePath,
        workdirContents: manifest.files,
        limits: this.options.limits,
        network: 'none',
      });
    } catch (error) {
      if (error instanceof SandboxInfraError) {
        this.options.logger?.warn('sandbox unavailable — falling back to in-process verification', {
          event_type: 'verification.sandbox_fallback',
          check_kind: this.kind,
          reason: error.message,
        });
        return this.options.inner.run(ctx);
      }
      throw error;
    }

    const combined = `${result.stdout}${result.stderr}`;
    return {
      checkKind: this.kind,
      status: result.timedOut
        ? CheckStatus.TIMED_OUT
        : result.exitCode === 0
          ? CheckStatus.PASSED
          : CheckStatus.FAILED,
      durationMs: result.durationMs,
      output: truncateOutput(combined),
      evidenceBody: combined,
    };
  }
}
