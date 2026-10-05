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

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { computeWorkdirManifest, SandboxInfraError } from '@harness/sandbox';
import type { Sandbox, SandboxLimits, SandboxResult } from '@harness/sandbox';
import { observeSandboxDuration, recordSandboxRun } from '@harness/observability';

import { truncateOutput } from './env.js';
import type { CheckKind, CheckResult } from './types.js';
import { CheckStatus } from './types.js';

/** A lockfile-revealed package manager — the tool that runs `run <script>`. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn';

/**
 * Declared `build`/`test` script *bodies* from the clone's `package.json`
 * (`undefined` = absent). The runner executes the literal script *name*
 * (`<pm> run build`), never these bodies as argv — presence here only decides
 * whether there is something to run.
 */
export interface PackageScripts {
  readonly build?: string;
  readonly test?: string;
}

/**
 * A resolved manifest plus where it was found. `subdir` is the one-level
 * child directory holding the winning `package.json` (`undefined`/absent =
 * root). Only ever a single path component from `readdir` — never nested,
 * never `..` — so `runScript` can safely `cd` into it inside the sandbox.
 */
export interface ResolvedPackageScripts extends PackageScripts {
  readonly subdir?: string;
}

/** Single-quote a string for POSIX `sh -lc` (alpine has no `bash`). */
function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** True when `subdir` is a safe single-level child (no traversal, no separator). */
function isSafeSubdir(subdir: string): boolean {
  return (
    subdir.length > 0 &&
    !subdir.includes('/') &&
    !subdir.includes('\\') &&
    subdir !== '.' &&
    subdir !== '..' &&
    !subdir.startsWith('.')
  );
}

/**
 * Node heap (MB) derived from the container memory limit: 3/4 of it, floor
 * 256. A real-world Angular build peaks past 1 GB of heap, so the 512m
 * default sandbox OOMs (`ng build` SIGABRT) while the container limit still
 * has room — sizing `--max-old-space-size` from the limit keeps the two
 * coherent. Returns `undefined` for an unparsable limit (heap flag omitted).
 */
export function heapMbForMemory(memory: string): number | undefined {
  const match = /^(\d+)([mMgG])$/.exec(memory.trim());
  if (!match) {
    return undefined;
  }
  const mb = match[2]?.toLowerCase() === 'g' ? Number(match[1]) * 1024 : Number(match[1]);
  if (!Number.isFinite(mb) || mb <= 0) {
    return undefined;
  }
  return Math.max(256, Math.floor(mb * 0.75));
}

/**
 * Detect the package manager from the lockfile next to the resolved manifest
 * (`pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, else `npm`). Falls back to
 * `npm` when the workdir is missing or has no lockfile — resolution "fails
 * open", never throws.
 */
export async function detectPackageManager(workdir: string, subdir?: string): Promise<PackageManager> {
  const base = subdir ? join(workdir, subdir) : workdir;
  try {
    await stat(join(base, 'pnpm-lock.yaml'));
    return 'pnpm';
  } catch {
    // No pnpm lockfile — try yarn next.
  }
  try {
    await stat(join(base, 'yarn.lock'));
    return 'yarn';
  } catch {
    // No yarn lockfile either — default to npm.
  }
  return 'npm';
}

/**
 * Parse a `package.json` body into its declared `build`/`test` script *bodies*.
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
 * Resolve a clone's declared build/test scripts from its `package.json`.
 *
 * Many real repos keep the frontend manifest one level down
 * (`<workdir>/ClientApp/package.json`, `frontend/`, `apps/web`, …) with no
 * root `package.json`. Reading only the root therefore misses the scripts and
 * SKIPs both checks forever. So: try root first, then each one-level child
 * (sorted alphabetically for determinism, skipping `.git`, `node_modules`,
 * and dot dirs like `.github`/`.husky`). The first manifest declaring a
 * `build` or `test` script wins, returning its `subdir` so the runner can `cd`
 * before running.
 *
 * Only one level deep, deliberately: deeper recursion would scan
 * `node_modules`/`dist`/`build` (slow + non-deterministic) and could pick up a
 * test-fixture `package.json` nested under `src/.../__tests__/`. Anything
 * deeper than one level should be declared explicitly, not guessed.
 *
 * A clone with no manifest (or an unreadable one) is not an error — it simply
 * declares nothing, so there is nothing to run.
 */
export async function resolvePackageScripts(workdir: string): Promise<ResolvedPackageScripts> {
  const candidates: string[] = [''];
  try {
    const entries = await readdir(workdir, { withFileTypes: true });
    const subdirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== 'node_modules' && !name.startsWith('.'))
      .sort();
    for (const subdir of subdirs) {
      candidates.push(subdir);
    }
  } catch {
    // Workdir unreadable (missing clone) — fall through to the root-only
    // attempt below, which degrades to {} on read failure.
  }
  for (const subdir of candidates) {
    let raw: string;
    try {
      raw = await readFile(join(workdir, subdir, 'package.json'), 'utf8');
    } catch {
      continue;
    }
    const parsed = parsePackageScripts(raw);
    if (parsed.build !== undefined || parsed.test !== undefined) {
      return subdir ? { ...parsed, subdir } : { ...parsed };
    }
  }
  return {};
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
  /**
   * Install `node_modules` before build/test when missing (default `true`).
   * The clone is source-only and the build sandbox has no network, so without
   * this every external repo 127s on its own CLI (`ng`, `jest`, …). The
   * install runs in its own container with `network: 'bridge'` (registry
   * egress for that step only); build/test stay on `'none'`. Set `false` to
   * opt out (`VERIFY_INSTALL_DEPS=0`).
   */
  readonly installDependencies?: boolean;
  /** Wall-clock budget for the install step in seconds (default 600). */
  readonly installTimeoutSeconds?: number;
}

/**
 * The frozen install argv for `pm` next to the manifest. A lockfile means a
 * reproducible `ci`/frozen install; without one it degrades to a plain
 * `install`. `pnpm`/`yarn` run through `corepack` (the pinned alpine image
 * ships only `npm`, and standalone `pnpm`/`yarn` binaries are not guaranteed)
 * with the download prompt disabled — the install step has registry egress.
 */
export function buildInstallArgs(pm: PackageManager, frozen: boolean): string[] {
  if (pm === 'npm') {
    return frozen ? ['npm', 'ci'] : ['npm', 'install', '--no-audit', '--no-fund'];
  }
  if (pm === 'pnpm') {
    return frozen
      ? ['corepack', 'pnpm', 'install', '--frozen-lockfile']
      : ['corepack', 'pnpm', 'install', '--no-frozen-lockfile'];
  }
  return frozen
    ? ['corepack', 'yarn', 'install', '--frozen-lockfile']
    : ['corepack', 'yarn', 'install'];
}

/** True when the manifest directory pins its deps with a lockfile. */
export async function hasLockfile(workdir: string, subdir?: string): Promise<boolean> {
  const base = subdir ? join(workdir, subdir) : workdir;
  for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
    try {
      await stat(join(base, lock));
      return true;
    } catch {
      // Absent — try the next lockfile name.
    }
  }
  return false;
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
    const resolved = await this.resolveScript(workdir, script);
    if (resolved === undefined) {
      return undefined;
    }
    const packageManager = this.options.packageManager ?? (await detectPackageManager(workdir, resolved.subdir));
    // The clone is source-only (`node_modules` never comes with `git clone`)
    // and the build container has no network — without an install step the
    // PR's own CLI (`ng`, `jest`, …) 127s. Install first (own container,
    // registry egress for that step only); an install failure is returned as
    // the result so the check records an honest FAILED with the install log.
    const installed = await this.ensureInstalled(workdir, resolved.subdir, packageManager);
    if (installed !== null && (installed.timedOut || installed.exitCode !== 0)) {
      return installed;
    }
    // Run the literal script *name* (`npm run build`), never the script body
    // (`ng build`) as argv. When the manifest lives in a subdir, `cd` there
    // first — the sandbox mounts the clone at /workdir with --workdir /workdir.
    // `sh` (not `bash`): the pinned `node:20-alpine` image has no bash, so
    // `bash -lc` exits 127 (a program result, not infra — see docker-sandbox
    // 127 discrimination). `NODE_OPTIONS` sizes the heap from the container
    // limit (Angular-class builds OOM otherwise); `npm_config_cache` keeps
    // npm's logs/cache writable under the read-only rootfs. `CI=true` +
    // `NGCLI_ANALYTICS=false` force non-interactive CLI behavior — Angular's
    // first-run analytics prompt / progress reporting can stall waiting on a
    // TTY that does not exist inside `docker run` (observed: `ng build` stuck
    // at "Generating browser application bundles (phase: setup)" until the
    // container was SIGKILLed at the step budget).
    const heap = heapMbForMemory(this.options.limits.memory);
    const envPrefix =
      `export CI=true NGCLI_ANALYTICS=false npm_config_cache=/tmp/npm-cache` +
      (heap !== undefined ? ` NODE_OPTIONS=--max-old-space-size=${heap}` : '');
    const command =
      resolved.subdir !== undefined
        ? ([
            'sh',
            '-lc',
            `cd ${quotePosix(resolved.subdir)} && ${envPrefix} && ${packageManager} run ${quotePosix(resolved.name)}`,
          ] as const)
        : ([packageManager, 'run', resolved.name] as const);
    const manifest = await computeWorkdirManifest(workdir);
    const result = await this.options.sandbox.run({
      command: [...command],
      image: this.options.image,
      workdirPath: workdir,
      workdirContents: manifest.files,
      limits: this.options.limits,
      network: 'none',
      // Angular-class builds spill well past the 64m default /tmp (compiler
      // temp + npm cache both live there under the read-only rootfs) — a full
      // /tmp stalls `ng build` in "setup" instead of failing loudly. 512m is
      // cheap insurance; the install step keeps its own 1g.
      tmpfsSize: '512m',
      workspaceWritable: true,
    });
    recordSandboxRun();
    observeSandboxDuration(result.durationMs / 1000);
    return result;
  }

  /**
   * Ensure `node_modules` exists for the manifest directory, installing it
   * when absent. Returns `null` when there is nothing to do (opted out or
   * already installed); otherwise the install container's result, tagged with
   * a `[deps]` prefix so a FAILED check reads as "install failed", never as
   * "build failed". A {@link SandboxInfraError} propagates (→ SKIPPED); a
   * non-zero install is returned (→ FAILED with the install log).
   */
  async ensureInstalled(
    workdir: string,
    subdir: string | undefined,
    packageManager: PackageManager,
  ): Promise<SandboxResult | null> {
    if (this.options.installDependencies === false) {
      return null;
    }
    const base = subdir ? join(workdir, subdir) : workdir;
    try {
      const st = await stat(join(base, 'node_modules'));
      if (st.isDirectory()) {
        return null;
      }
    } catch {
      // Missing — fall through to the install below.
    }
    const frozen = await hasLockfile(workdir, subdir);
    const args = buildInstallArgs(packageManager, frozen);
    // The rootfs is `--read-only` with only `/tmp` writable, so point every
    // package-manager cache at `/tmp` — otherwise `ci` dies writing `~/.npm`.
    // `sh` (not `bash`): the pinned `node:20-alpine` image has no bash.
    // `2>&1` keeps npm's stdout/stderr in one ordered stream (its `npm error`
    // block was otherwise lost between the two pipes); on failure the npm
    // debug log tail is appended so the real reason (EUSAGE/EBADENGINE/EACCES/
    // ENOSPC/ELIFECYCLE…) is in the check output instead of a dead log path
    // inside the removed container.
    const cd = subdir !== undefined ? `cd ${quotePosix(subdir)} && ` : '';
    const installPart = args.map((part) => quotePosix(part)).join(' ');
    const script =
      `${cd}export npm_config_cache=/tmp/npm-cache XDG_CACHE_HOME=/tmp/.cache ` +
      `COREPACK_HOME=/tmp/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0 && ` +
      `{ ${installPart} 2>&1 || { code=$?; echo '[deps] install failed — npm debug log tail:'; ` +
      `tail -n 40 /tmp/npm-cache/_logs/*debug*.log 2>/dev/null; exit $code; }; }`;
    const timeoutSeconds = this.options.installTimeoutSeconds ?? 600;
    const manifest = await computeWorkdirManifest(workdir);
    const result = await this.options.sandbox.run({
      command: ['sh', '-lc', script],
      image: this.options.image,
      workdirPath: workdir,
      workdirContents: manifest.files,
      limits: { ...this.options.limits, timeoutSeconds },
      network: 'bridge',
      // A cold package cache for a large app is hundreds of MB — the 64m
      // default tmpfs makes `npm ci` die ENOSPC (seen on horizon2-ui).
      tmpfsSize: '1g',
      workspaceWritable: true,
    });
    recordSandboxRun();
    observeSandboxDuration(result.durationMs / 1000);
    const prefix = `[deps] ${args.join(' ')}${subdir ? ` (in ${subdir}/)` : ''}\n`;
    return { ...result, stdout: `${prefix}${result.stdout}`, stderr: result.stderr };
  }

  /**
   * Override wins for the script *name*, but the `subdir` still comes from
   * manifest resolution so an explicit override also runs in the right
   * directory. Otherwise the literal script name (`build`/`test`) runs when
   * the manifest declares it — never the script *body* (`ng build`) as argv,
   * which the package manager would read as a script called `ng build`.
   */
  private async resolveScript(
    workdir: string,
    script: 'build' | 'test',
  ): Promise<{ name: string; subdir?: string } | undefined> {
    const declared = await resolvePackageScripts(workdir);
    const subdir = declared.subdir !== undefined && isSafeSubdir(declared.subdir) ? declared.subdir : undefined;
    const override = script === 'build' ? this.options.buildCommand : this.options.testCommand;
    if (override !== undefined) {
      return { name: override, ...(subdir !== undefined ? { subdir } : {}) };
    }
    const isDeclared = script === 'build' ? declared.build !== undefined : declared.test !== undefined;
    if (!isDeclared) {
      return undefined;
    }
    return { name: script, ...(subdir !== undefined ? { subdir } : {}) };
  }
}

/** Map a raw sandbox measurement to the check vocabulary (exit code → status). */
export function toCheckResult(kind: CheckKind, result: SandboxResult, durationMs: number): CheckResult {
  const combined = `${result.stdout}${result.stderr}`;
  // 127 from inside the container means "command not found" — almost always a
  // missing toolchain (`pnpm`/`yarn` — the image ships only npm, the rest go
  // through `corepack`) or an uninstalled `node_modules/.bin`. Without this
  // hint the bare `sh: ...: not found` reads as infra noise.
  const body =
    result.exitCode === 127 && !result.timedOut
      ? `${combined}\n[hint] exit 127 = command not found inside the sandbox image (only npm preinstalled; pnpm/yarn via corepack) or missing node_modules/.bin — check the [deps] install log above`
      : combined;
  return {
    checkKind: kind,
    status: result.timedOut ? CheckStatus.TIMED_OUT : result.exitCode === 0 ? CheckStatus.PASSED : CheckStatus.FAILED,
    durationMs,
    exitCode: result.exitCode,
    output: truncateOutput(body),
    evidenceBody: body,
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
  const check = toCheckResult(kind, result, Date.now() - started);
  // Host-side probe: the sandbox bind-mounts the clone, so a missing
  // `node_modules` on the host is also missing inside. When the container
  // already said "command not found", name the directory so the row tells the
  // operator exactly where `npm ci` (or a toolchain install) is needed.
  if (result.exitCode === 127 && !result.timedOut) {
    const declared = await resolvePackageScripts(workdir).catch(() => ({} as ResolvedPackageScripts));
    const base = declared.subdir ? join(workdir, declared.subdir) : workdir;
    try {
      await stat(join(base, 'node_modules'));
    } catch {
      const location = declared.subdir ? `${declared.subdir}/` : '';
      const extra = ` — no node_modules in ${location || 'workdir'} (clone is source-only, sandbox has no network to install)`;
      return { ...check, output: truncateOutput(`${check.output}${extra}`) };
    }
  }
  return check;
}
