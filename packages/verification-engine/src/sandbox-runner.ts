/**
 * `SandboxRunner` (day-12 §3.2) — runs a clone's *own* build/test scripts inside
 * the Docker sandbox, instead of the harness's hardcoded `tsc`/`vitest`.
 *
 * The clone checks (`clone-checks/`) share one runner, and the runner owns only
 * the mechanical half they both need: resolve the script (from the clone's
 * `package.json`, or a caller override), construct the isolated {@link SandboxRun}
 * from the clone worktree, and map the raw `SandboxResult` back to the check
 * vocabulary. Ordering (COMPILE before TEST, short-circuit on failure) and report
 * assembly live in `clone-verifier.ts`, not here — a runner runs one command, it
 * never decides what a failure *means*.
 *
 * Two distinctions from the Day-22 `SandboxedCheck` path:
 *
 *  1. This path is **sandbox-only** — there is no in-process fallback. The
 *     clone's scripts are the PR's code + its own dependency graph; running them
 *     in the harness process would execute untrusted code here (the one rule the
 *     security posture forbids). A {@link SandboxInfraError} is therefore an
 *     honest `SKIPPED`, never a silent in-process rerun.
 *  2. The workspace mount is **writable** inside the container (`workspaceWritable:
 *     true`) — `build`/`test` write `dist`/coverage/reporter files as a matter of
 *     course. The rootfs stays `--read-only` either way; the disposable surface is
 *     the throwaway clone worktree itself (day-12 §2.3).
 */

import { readFile } from 'node:fs/promises';

import { computeWorkdirManifest, SandboxInfraError } from '@harness/sandbox';
import type { Sandbox, SandboxLimits, SandboxResult } from '@harness/sandbox';
import { observeSandboxDuration, recordSandboxRun } from '@harness/observability';

import { truncateOutput } from './env.js';
import type { CheckKind, CheckResult } from './types.js';
import { CheckStatus } from './types.js';

/** A lockfile-revealed package manager — the tool that runs `run <script>`. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn';

/** A script name resolved from the clone's `package.json` (`undefined` = absent). */
export interface PackageScripts {
  readonly build?: string;
  readonly test?: string;
}

/**
 * Parse a `package.json` body into its declared `build`/`test` script *names*.
 * Malformed JSON or a missing `scripts` block yields an empty object — resolution
 * "fails open" (no script → the check records SKIPPED), never a throw.
 */
export function parsePackageScripts(raw: string): PackageScripts {
  let pkg: unknown;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof pkg !== 'object' || pkg === null) {
    return {};
  }
  const scripts = (pkg as { scripts?: unknown }).scripts;
  if (typeof scripts !== 'object' || scripts === null) {
    return {};
  }
  const declared = scripts as Record<string, unknown>;
  return {
    ...(typeof declared.build === 'string' ? { build: declared.build } : {}),
    ...(typeof declared.test === 'string' ? { test: declared.test } : {}),
  };
}

/**
 * Resolve a clone's declared build/test scripts from its `package.json`. A clone
 * with no manifest (or an unreadable one) is not an error — it simply declares
 * nothing, so there is nothing to run.
 */
export async function resolvePackageScripts(workdir: string): Promise<PackageScripts> {
  let raw: string;
  try {
    raw = await readFile(`${workdir}/package.json`, 'utf8');
  } catch {
    return {};
  }
  return parsePackageScripts(raw);
}

/** Injectable knobs for {@link SandboxRunner}. */
export interface SandboxRunnerOptions {
  /** The isolation runtime. */
  readonly sandbox: Sandbox;
  /** The pinned image the command runs inside (never `latest`). */
  readonly image: string;
  /** Resource + wall-clock budgets (the timeout is enforced at the container). */
  readonly limits: SandboxLimits;
  /** The tool that runs `run <script>` (default `npm`). */
  readonly packageManager?: PackageManager;
  /** Override the resolved `build` script *name* (skip `package.json`). */
  readonly buildCommand?: string;
  /** Override the resolved `test` script *name* (skip `package.json`). */
  readonly testCommand?: string;
}

/** Runs one of a clone's declared scripts in the sandbox. */
export class SandboxRunner {
  constructor(private readonly options: SandboxRunnerOptions) {}

  /** Run the clone's `build` script; `undefined` when it declares (or overrides) none. */
  runBuild(workdir: string): Promise<SandboxResult | undefined> {
    return this.runScript(workdir, 'build');
  }

  /** Run the clone's `test` script; `undefined` when it declares (or overrides) none. */
  runTest(workdir: string): Promise<SandboxResult | undefined> {
    return this.runScript(workdir, 'test');
  }

  /** Resolve + run one of the clone's scripts, mapped to the sandbox runtime. */
  async runScript(workdir: string, script: 'build' | 'test'): Promise<SandboxResult | undefined> {
    const scriptName = await this.resolveScriptName(workdir, script);
    if (scriptName === undefined) {
      return undefined;
    }
    const manifest = await computeWorkdirManifest(workdir);
    const result = await this.options.sandbox.run({
      command: [this.options.packageManager ?? 'npm', 'run', scriptName],
      image: this.options.image,
      workdirPath: workdir,
      workdirContents: manifest.files,
      limits: this.options.limits,
      network: 'none',
      workspaceWritable: true,
    });
    recordSandboxRun();
    observeSandboxDuration(result.durationMs / 1000);
    return result;
  }

  /** Override wins; otherwise the clone's declared script name for `script`. */
  private async resolveScriptName(
    workdir: string,
    script: 'build' | 'test',
  ): Promise<string | undefined> {
    const override = script === 'build' ? this.options.buildCommand : this.options.testCommand;
    if (override !== undefined) {
      return override;
    }
    const declared = await resolvePackageScripts(workdir);
    return script === 'build' ? declared.build : declared.test;
  }
}

/** Map a raw sandbox measurement to the check vocabulary (exit code → status). */
export function toCheckResult(
  kind: CheckKind,
  result: SandboxResult,
  durationMs: number,
): CheckResult {
  const combined = `${result.stdout}${result.stderr}`;
  return {
    checkKind: kind,
    status: result.timedOut
      ? CheckStatus.TIMED_OUT
      : result.exitCode === 0
        ? CheckStatus.PASSED
        : CheckStatus.FAILED,
    durationMs,
    output: truncateOutput(combined),
    evidenceBody: combined,
  };
}

/**
 * Run one script as a check (the shared body of `CloneCompileCheck` /
 * `CloneTestCheck`). Produces a {@link CheckResult} for every outcome:
 *
 *  - exit 0 → `PASSED`, non-zero → `FAILED`, container-killed → `TIMED_OUT`;
 *  - no declared script → `SKIPPED`;
 *  - {@link SandboxInfraError} (daemon down / image missing) → `SKIPPED` with the
 *    infra reason — sandbox-only, so this is "could not verify", never a verdict
 *    on the PR and never an in-process fallback (day-12 §2.3, §3.1);
 *  - any other throw → `FAILED` carrying the message, so a check never kills the
 *    fail-closed sequence.
 */
export async function runScriptCheck(
  runner: SandboxRunner,
  kind: CheckKind,
  script: 'build' | 'test',
  workdir: string,
): Promise<CheckResult> {
  const started = Date.now();
  let result: SandboxResult | undefined;
  try {
    result = await runner.runScript(workdir, script);
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof SandboxInfraError) {
      return {
        checkKind: kind,
        status: CheckStatus.SKIPPED,
        durationMs,
        output: `sandbox unavailable: ${error.message}`,
      };
    }
    return {
      checkKind: kind,
      status: CheckStatus.FAILED,
      durationMs,
      output: `${script} check error: ${String(error)}`,
    };
  }
  if (result === undefined) {
    return {
      checkKind: kind,
      status: CheckStatus.SKIPPED,
      durationMs: Date.now() - started,
      output: `no ${script} script declared`,
    };
  }
  return toCheckResult(kind, result, Date.now() - started);
}
