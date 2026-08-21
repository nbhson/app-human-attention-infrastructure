/**
 * `TestCheck` (day-16 §2.1) — runs the worktree's Vitest suite, parses structured
 * results, and applies the spec's **flaky rule** (§5.6): a non-passing run is
 * retried **once**; pass-on-retry → `FLAKY`, fail-again → `FAILED`.
 *
 * Like `CompileCheck`, this is db-free: the check returns per-test rows inside
 * `CheckResult.testResults` and the *engine* persists them (it owns the
 * generated `verification_check_results.id` that the rows link to — see §2.3's
 * FK). The child process is a `detached` process group so a level-1 timeout can
 * kill the **whole group** (`process.kill(-pid, 'SIGKILL')`) — Vitest spawns
 * worker threads; killing only the parent leaks them and hangs the API (§2.1).
 *
 * The binary is resolved through the workspace install (not `pnpm exec`, which
 * resets the child cwd — same pitfall noted in `CompileCheck`) and driven via
 * `node`. `--root` pins Vitest to the worktree so a bare worktree never walks up
 * to the monorepo's root `vitest.config.ts`; `--passWithNoTests` keeps bare
 * worktrees (compile-only fixtures) passing.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { readInt, sanitizedEnv, truncateOutput } from '../env.js';
import { parseVitestJson } from '../parse-vitest-json.js';
import type { CheckContext, CheckResult, ParsedTestResult, VerificationCheck } from '../types.js';
import { CheckKind, CheckStatus } from '../types.js';

const require = createRequire(import.meta.url);
const DEFAULT_VITEST_BIN = require.resolve('vitest/vitest.mjs');

/** The raw result of one `vitest run` invocation. */
export interface VitestRun {
  /** Exit code; `null` when the group was SIGKILLed on timeout or spawn failed. */
  readonly code: number | null;
  /** Capped human stdout/stderr (the `output` field, §6). */
  readonly output: string;
  /** Full, uncapped stdout/stderr — stored as `CHECK_OUTPUT` evidence (Day 17). */
  readonly evidenceBody: string;
  /** Per-test rows parsed from the JSON reporter's `--outputFile`. */
  readonly results: ParsedTestResult[];
  /** True when the level-1 budget elapsed and the process group was killed. */
  readonly timedOut: boolean;
}

export class TestCheck implements VerificationCheck {
  readonly kind = CheckKind.TEST;
  readonly timeoutMs: number;
  /** Injectable binary path — tests point this at a synthetic script for kill. */
  private readonly vitestBin: string;

  constructor(timeoutMs: number = readInt('VERIFY_TEST_TIMEOUT_MS', 90_000), vitestBin?: string) {
    this.timeoutMs = timeoutMs;
    this.vitestBin = vitestBin ?? DEFAULT_VITEST_BIN;
  }

  async run(ctx: CheckContext): Promise<CheckResult> {
    const started = Date.now();

    const first = await this.runVitest(ctx);
    if (first.code === 0) {
      return {
        checkKind: this.kind,
        status: CheckStatus.PASSED,
        durationMs: Date.now() - started,
        output: first.output,
        evidenceBody: first.evidenceBody,
        testResults: first.results,
      };
    }

    // §5.6 flaky rule: exactly one retry on a non-passing first run.
    const second = await this.runVitest(ctx);
    const durationMs = Date.now() - started;

    if (second.timedOut) {
      return {
        checkKind: this.kind,
        status: CheckStatus.TIMED_OUT,
        durationMs,
        output: second.output,
        evidenceBody: second.evidenceBody,
      };
    }

    const flaky = second.code === 0;
    return {
      checkKind: this.kind,
      status: flaky ? CheckStatus.FLAKY : CheckStatus.FAILED,
      durationMs,
      output: (flaky ? second : first).output,
      evidenceBody: (flaky ? second : first).evidenceBody,
      testResults: (flaky ? second : first).results,
      retried: true,
    };
  }

  /**
   * Run one `vitest run` over `ctx.worktreePath`, killing the process group if
   * it exceeds `timeoutMs`. Overridable so integration tests can substitute a
   * deterministic fake without invoking a real (nested) Vitest.
   */
  protected runVitest(ctx: CheckContext): Promise<VitestRun> {
    const outputFile = `${ctx.worktreePath}/.vitest-out.json`;
    const proc: ChildProcess = spawn(
      process.execPath,
      [
        this.vitestBin,
        'run',
        '--root',
        ctx.worktreePath,
        '--passWithNoTests',
        '--reporter=json',
        '--outputFile',
        outputFile,
      ],
      {
        cwd: ctx.worktreePath,
        env: sanitizedEnv(process.env),
        detached: true,
      },
    );

    let output = '';
    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    return new Promise<VitestRun>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        // Kill the entire process group — Vitest's workers die with the parent.
        try {
          process.kill(-(proc.pid as number), 'SIGKILL');
        } catch {
          // Group already gone (e.g. the parent exited between timeout and kill).
        }
        const full = output + `\n...[test timed out after ${this.timeoutMs}ms]`;
        resolve({
          code: null,
          output: truncateOutput(full),
          evidenceBody: full,
          results: [],
          timedOut: true,
        });
      }, this.timeoutMs);

      proc.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const full = output + `\n...[test spawn error: ${String(error)}]`;
        resolve({
          code: null,
          output: truncateOutput(full),
          evidenceBody: full,
          results: [],
          timedOut: false,
        });
      });

      proc.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        void readFile(outputFile, 'utf8')
          .then((raw) => {
            resolve({
              code,
              output: truncateOutput(output),
              evidenceBody: output,
              results: parseVitestJson(raw),
              timedOut: code === null,
            });
          })
          .catch(() => {
            // Killed before writing the reporter file — no leaf rows, never throw.
            resolve({
              code,
              output: truncateOutput(output),
              evidenceBody: output,
              results: [],
              timedOut: code === null,
            });
          });
      });
    });
  }
}
