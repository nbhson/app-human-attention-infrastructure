/**
 * `CompileCheck` (day-15 §2.3) — the first real check.
 *
 * Runs `tsc --noEmit` **in-process on the agent's dedicated worktree** (the
 * project's `repo_path`, resolved by the engine's `buildContext`). Phase 1 does
 * not use containers (§5.5 fix). The child process is spawned with a
 * `sanitizedEnv` so an `ANTHROPIC_API_KEY` in the parent never reaches `tsc`.
 *
 * The inline `output` field is capped at 64 KB (tsc can dump megabytes on a
 * broken workspace) but the **full** output is retained in `evidenceBody` so the
 * engine can store untruncated `CHECK_OUTPUT` evidence (Day 17). The per-check
 * timeout is enforced by the engine's level-1 `withTimeout`; the child is *not*
 * aborted on timeout in Phase 1 (documented trade-off — sandboxing lands in
 * Phase 2).
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

import { readInt, sanitizedEnv, truncateOutput } from '../env.js';
import type { CheckContext, CheckResult, VerificationCheck } from '../types.js';
import { CheckKind, CheckStatus } from '../types.js';

// `pnpm exec` resets the child's cwd to the package root (§6 pitfall), which
// would make `-p .` point at *our* tsconfig instead of the worktree's. Resolve
// the `tsc` CLI directly through the workspace install and drive it via `node`.
const require = createRequire(import.meta.url);
const TSC_BIN = require.resolve('typescript/bin/tsc');

interface TscRun {
  readonly code: number | null;
  /** Full (uncapped) stdout/stderr — the `evidenceBody` source of truth. */
  readonly output: string;
}

/** Spawn `tsc --noEmit` over `worktreePath` and collect its full output. */
function runTsc(worktreePath: string): Promise<TscRun> {
  const proc: ChildProcess = spawn(process.execPath, [TSC_BIN, '--noEmit', '-p', worktreePath], {
    cwd: worktreePath,
    env: sanitizedEnv(process.env),
  });

  let output = '';
  const onData = (chunk: Buffer): void => {
    output += chunk.toString('utf8');
  };
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);

  return new Promise<TscRun>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({ code, output });
    });
  });
}

export class CompileCheck implements VerificationCheck {
  readonly kind = CheckKind.COMPILE;
  readonly timeoutMs: number;

  constructor(timeoutMs: number = readInt('VERIFY_COMPILE_TIMEOUT_MS', 60_000)) {
    this.timeoutMs = timeoutMs;
  }

  async run(ctx: CheckContext): Promise<CheckResult> {
    const started = Date.now();
    try {
      const { code, output } = await runTsc(ctx.worktreePath);
      return {
        checkKind: this.kind,
        status: code === 0 ? CheckStatus.PASSED : CheckStatus.FAILED,
        durationMs: Date.now() - started,
        output: truncateOutput(output),
        evidenceBody: output,
      };
    } catch (error) {
      // Spawn failure (e.g. `tsc` not on PATH) is a check-infra error → FAILED
      // with the underlying message, never a throw that kills sibling checks.
      return {
        checkKind: this.kind,
        status: CheckStatus.FAILED,
        durationMs: Date.now() - started,
        output: `compile check error: ${String(error)}`,
      };
    }
  }
}
