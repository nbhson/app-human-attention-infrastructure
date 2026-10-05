import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SandboxInfraError } from '@harness/sandbox';
import type { Sandbox, SandboxResult, SandboxRun } from '@harness/sandbox';
import { describe, expect, it } from 'vitest';

import { CloneCompileCheck } from '../clone-checks/compile-check.js';
import { CloneTestCheck } from '../clone-checks/test-check.js';
import { CloneVerifier } from '../clone-verifier.js';
import type { CloneWorktree } from '../clone-verifier.js';
import { buildInstallArgs, detectPackageManager, hasLockfile, heapMbForMemory, parsePackageScripts, resolvePackageScripts, SandboxRunner } from '../sandbox-runner.js';
import type { SandboxRunnerOptions } from '../sandbox-runner.js';
import { CheckKind, CheckStatus } from '../types.js';

const LEFT = 'a'.repeat(40);

/** A clone checkout fixture pointing at a path that does not exist — the manifest
 * walk degrades to an empty manifest (so no disk I/O) and the runner's overrides
 * bypass `package.json` resolution. */
const clone: CloneWorktree = {
  workdir: '/tmp/nonexistent-clone',
  headSha: LEFT,
  sourceBranch: 'feature/x',
  targetBranch: 'main',
};

function result(overrides: Partial<SandboxResult> = {}): SandboxResult {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1, ...overrides };
}

/** A `Sandbox` that replays fixed outcomes and records every `SandboxRun`. */
class ScriptedSandbox implements Sandbox {
  readonly runs: SandboxRun[] = [];
  private index = 0;

  constructor(private readonly outcomes: Array<SandboxResult | Error>) {}

  run(run: SandboxRun): Promise<SandboxResult> {
    this.runs.push(run);
    const outcome = this.outcomes[this.index] ?? result();
    this.index += 1;
    if (outcome instanceof Error) {
      return Promise.reject(outcome);
    }
    return Promise.resolve(outcome);
  }
}

function runner(sandbox: Sandbox, overrides: Partial<SandboxRunnerOptions> = {}): SandboxRunner {
  return new SandboxRunner({
    sandbox,
    image: 'harness-verify:node20',
    limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 60 },
    buildCommand: 'build',
    testCommand: 'test',
    // These ordering tests use a nonexistent workdir — disable the install
    // step to isolate verifier behavior (install has its own suite below).
    installDependencies: false,
    ...overrides,
  });
}

function verifier(sandbox: Sandbox): { sb: ScriptedSandbox; verifier: CloneVerifier } {
  const sb = sandbox as ScriptedSandbox;
  const r = runner(sb);
  return {
    sb,
    verifier: new CloneVerifier({ compile: new CloneCompileCheck(r), test: new CloneTestCheck(r) }),
  };
}

describe('CloneVerifier (day-12 §3)', () => {
  it('runs the clone build then test through the sandbox with the right argv + isolation', async () => {
    const sb = new ScriptedSandbox([result(), result()]);
    const { verifier: v } = verifier(sb);

    const report = await v.verify(clone);

    expect(report.overall).toBe('PASSED');
    expect(report.failedChecks).toEqual([]);
    expect(report.headSha).toBe(LEFT);

    expect(sb.runs).toHaveLength(2);
    expect(sb.runs[0]?.command).toEqual(['npm', 'run', 'build']);
    expect(sb.runs[1]?.command).toEqual(['npm', 'run', 'test']);
    for (const run of sb.runs) {
      expect(run.image).toBe('harness-verify:node20');
      expect(run.workdirPath).toBe(clone.workdir);
      expect(run.network).toBe('none');
      expect(run.workspaceWritable).toBe(true); // build/test write output inside the container
    }
  });

  it('short-circuits TEST when COMPILE fails (fail-closed ordering)', async () => {
    const sb = new ScriptedSandbox([result({ exitCode: 2, stderr: 'TS2322: boom' })]);
    const { verifier: v } = verifier(sb);

    const report = await v.verify(clone);

    expect(report.overall).toBe('FAILED');
    expect(report.failedChecks).toEqual([CheckKind.COMPILE]);
    expect(report.checks[0]?.status).toBe(CheckStatus.FAILED);
    expect(report.checks[0]?.output).toContain('TS2322: boom');
    // TEST was never run — its check is SKIPPED and the build was the only sandbox run.
    expect(report.checks[1]?.status).toBe(CheckStatus.SKIPPED);
    expect(report.checks[1]?.output).toContain('compile did not pass');
    expect(sb.runs).toHaveLength(1);
    expect(sb.runs[0]?.command).toEqual(['npm', 'run', 'build']);
  });

  it('maps a container timeout to TIMED_OUT and short-circuits', async () => {
    const sb = new ScriptedSandbox([result({ exitCode: 137, timedOut: true, stderr: 'killed' })]);
    const { verifier: v } = verifier(sb);

    const report = await v.verify(clone);

    expect(report.checks[0]?.status).toBe(CheckStatus.TIMED_OUT);
    expect(report.overall).toBe('FAILED');
    expect(report.checks[1]?.status).toBe(CheckStatus.SKIPPED);
  });

  it('records SKIPPED (not FAILED) on SandboxInfraError — the clone path has no in-process fallback', async () => {
    const sb = new ScriptedSandbox([new SandboxInfraError('Cannot connect to the Docker daemon')]);
    const { verifier: v } = verifier(sb);

    const report = await v.verify(clone);

    expect(report.checks[0]?.status).toBe(CheckStatus.SKIPPED);
    expect(report.checks[0]?.output).toContain('sandbox unavailable');
    expect(report.overall).toBe('FAILED');
  });

  it('does not leak a hard throw — maps it to FAILED and still returns a report', async () => {
    const sb = new ScriptedSandbox([result(), new Error('sandbox panic')]);
    const { verifier: v } = verifier(sb);

    const report = await v.verify(clone);

    expect(report.checks[0]?.status).toBe(CheckStatus.PASSED);
    expect(report.checks[1]?.status).toBe(CheckStatus.FAILED);
    expect(report.checks[1]?.output).toContain('test check error');
    expect(report.overall).toBe('FAILED');
  });
});

describe('SandboxRunner script resolution (day-12 §3.2)', () => {
  it('records SKIPPED when the clone declares no build script (and no override)', async () => {
    const sb = new ScriptedSandbox([]);
    // No buildCommand/testCommand overrides → falls through to package.json,
    // which does not exist under the fake workdir.
    const r = new SandboxRunner({
      sandbox: sb,
      image: 'harness-verify:node20',
      limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 60 },
    });

    const checkResult = await new CloneCompileCheck(r).run('/tmp/nonexistent');

    expect(checkResult.status).toBe(CheckStatus.SKIPPED);
    expect(checkResult.output).toContain('no build script');
    expect(sb.runs).toHaveLength(0);
  });

  it('resolves the clone package.json from disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-verify-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc -p .', test: 'vitest run' } }));

    expect(await resolvePackageScripts(dir)).toEqual({ build: 'tsc -p .', test: 'vitest run' });
  });

  it('resolves a nested one-level manifest (ClientApp) with its subdir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-verify-nested-'));
    mkdirSync(join(dir, 'ClientApp'));
    writeFileSync(
      join(dir, 'ClientApp', 'package.json'),
      JSON.stringify({ scripts: { build: 'ng build', test: 'jest' } }),
    );

    expect(await resolvePackageScripts(dir)).toEqual({ build: 'ng build', test: 'jest', subdir: 'ClientApp' });
  });

  it('prefers root over a nested manifest and ignores node_modules/dot dirs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-verify-rootfirst-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc -p .', test: 'vitest run' } }));
    mkdirSync(join(dir, 'ClientApp'));
    writeFileSync(join(dir, 'ClientApp', 'package.json'), JSON.stringify({ scripts: { build: 'ng build' } }));
    // A manifest hiding in node_modules or a dot dir must never win.
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'package.json'), JSON.stringify({ scripts: { build: 'evil' } }));
    mkdirSync(join(dir, '.github'));
    writeFileSync(join(dir, '.github', 'package.json'), JSON.stringify({ scripts: { build: 'evil' } }));

    expect(await resolvePackageScripts(dir)).toEqual({ build: 'tsc -p .', test: 'vitest run' });
  });

  it('runs the nested script via sh -lc with cd (alpine has no bash)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-verify-cd-'));
    mkdirSync(join(dir, 'ClientApp'));
    writeFileSync(
      join(dir, 'ClientApp', 'package.json'),
      JSON.stringify({ scripts: { build: 'ng build', test: 'jest' } }),
    );
    // Deps present so the test isolates the cd/argv behavior (no install run).
    mkdirSync(join(dir, 'ClientApp', 'node_modules'));
    const sb = new ScriptedSandbox([result(), result()]);
    const r = new SandboxRunner({
      sandbox: sb,
      image: 'harness-verify:node20',
      limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 60 },
    });

    const report = await new CloneVerifier({
      compile: new CloneCompileCheck(r),
      test: new CloneTestCheck(r),
    }).verify({ workdir: dir, headSha: LEFT, sourceBranch: 'b', targetBranch: 'main' });

    expect(report.checks[0]?.status).toBe(CheckStatus.PASSED);
    expect(sb.runs).toHaveLength(2);
    // Literal script *name* (`run build`), never the body (`ng build`) as argv.
    // Heap follows the container limit (512m → 384); npm cache stays on /tmp;
    // CI=true + NGCLI_ANALYTICS=false keep Angular non-interactive (no TTY stall).
    expect(sb.runs[0]?.command).toEqual([
      'sh',
      '-lc',
      `cd 'ClientApp' && export CI=true NGCLI_ANALYTICS=false npm_config_cache=/tmp/npm-cache NODE_OPTIONS=--max-old-space-size=384 && npm run 'build'`,
    ]);
    expect(sb.runs[1]?.command).toEqual([
      'sh',
      '-lc',
      `cd 'ClientApp' && export CI=true NGCLI_ANALYTICS=false npm_config_cache=/tmp/npm-cache NODE_OPTIONS=--max-old-space-size=384 && npm run 'test'`,
    ]);
  });

  it('detects the package manager from the lockfile next to the manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-verify-pm-'));
    mkdirSync(join(dir, 'ClientApp'));
    writeFileSync(join(dir, 'ClientApp', 'package.json'), JSON.stringify({ scripts: { build: 'x' } }));

    expect(await detectPackageManager(dir, 'ClientApp')).toBe('npm');
    writeFileSync(join(dir, 'ClientApp', 'yarn.lock'), '');
    expect(await detectPackageManager(dir, 'ClientApp')).toBe('yarn');
    writeFileSync(join(dir, 'ClientApp', 'pnpm-lock.yaml'), '');
    expect(await detectPackageManager(dir, 'ClientApp')).toBe('pnpm');
  });
  it('maps container exit 127 to FAILED with a toolchain hint (not a blind SKIP)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-verify-127-'));
    mkdirSync(join(dir, 'ClientApp'));
    writeFileSync(
      join(dir, 'ClientApp', 'package.json'),
      JSON.stringify({ scripts: { build: 'ng build', test: 'jest' } }),
    );
    // No node_modules in ClientApp — the clone is source-only. Install is
    // disabled here to isolate the 127 hint/probe behavior.
    const sb = new ScriptedSandbox([result({ exitCode: 127, stderr: 'sh: ng: not found\n' })]);
    const r = new SandboxRunner({
      sandbox: sb,
      image: 'harness-verify:node20',
      limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 60 },
      installDependencies: false,
    });

    const checkResult = await new CloneCompileCheck(r).run(dir);

    expect(checkResult.status).toBe(CheckStatus.FAILED);
    expect(checkResult.output).toContain('ng: not found');
    expect(checkResult.output).toContain('exit 127');
    expect(checkResult.output).toContain('no node_modules in ClientApp/');
  });
});

describe('SandboxRunner deps install', () => {
  function workdirWithManifest(subdir = 'ClientApp'): string {
    const dir = mkdtempSync(join(tmpdir(), 'clone-verify-install-'));
    mkdirSync(join(dir, subdir));
    writeFileSync(
      join(dir, subdir, 'package.json'),
      JSON.stringify({ scripts: { build: 'ng build', test: 'jest' } }),
    );
    return dir;
  }

  it('builds frozen install args per package manager (corepack for pnpm/yarn)', () => {
    expect(buildInstallArgs('npm', true)).toEqual(['npm', 'ci']);
    expect(buildInstallArgs('npm', false)).toEqual(['npm', 'install', '--no-audit', '--no-fund']);
    expect(buildInstallArgs('pnpm', true)).toEqual(['corepack', 'pnpm', 'install', '--frozen-lockfile']);
    expect(buildInstallArgs('yarn', true)).toEqual(['corepack', 'yarn', 'install', '--frozen-lockfile']);
  });

  it('detects a lockfile next to the manifest', async () => {
    const dir = workdirWithManifest();
    expect(await hasLockfile(dir, 'ClientApp')).toBe(false);
    writeFileSync(join(dir, 'ClientApp', 'package-lock.json'), '{}');
    expect(await hasLockfile(dir, 'ClientApp')).toBe(true);
  });

  it('sizes the node heap at 3/4 of the container memory', () => {
    expect(heapMbForMemory('512m')).toBe(384);
    expect(heapMbForMemory('4g')).toBe(3072);
    expect(heapMbForMemory('2G')).toBe(1536);
    expect(heapMbForMemory('')).toBeUndefined();
    expect(heapMbForMemory('huge')).toBeUndefined();
  });

  it('skips the install when node_modules already exists (no extra sandbox run)', async () => {
    const dir = workdirWithManifest();
    mkdirSync(join(dir, 'ClientApp', 'node_modules'));
    const sb = new ScriptedSandbox([result()]);
    const r = new SandboxRunner({
      sandbox: sb,
      image: 'harness-verify:node20',
      limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 60 },
    });

    const checkResult = await new CloneCompileCheck(r).run(dir);

    expect(checkResult.status).toBe(CheckStatus.PASSED);
    expect(sb.runs).toHaveLength(1); // build only, no install
    expect(sb.runs[0]?.network).toBe('none');
  });

  it('installs with registry egress before build, then runs the build offline', async () => {
    const dir = workdirWithManifest();
    writeFileSync(join(dir, 'ClientApp', 'package-lock.json'), '{}');
    const sb = new ScriptedSandbox([result(), result()]);
    const r = new SandboxRunner({
      sandbox: sb,
      image: 'harness-verify:node20',
      limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 60 },
    });

    const checkResult = await new CloneCompileCheck(r).run(dir);

    expect(checkResult.status).toBe(CheckStatus.PASSED);
    expect(sb.runs).toHaveLength(2);
    expect(sb.runs[0]?.network).toBe('bridge'); // install: registry egress
    expect(sb.runs[0]?.tmpfsSize).toBe('1g'); // install: cold cache needs room (64m dies ENOSPC)
    expect(sb.runs[0]?.command.slice(0, 2)).toEqual(['sh', '-lc']);
    expect(sb.runs[0]?.command[2]).toContain('npm');
    expect(sb.runs[0]?.command[2]).toContain('ci');
    // Failure debug: merged stream + npm debug-log tail so the real reason
    // (EUSAGE/ENOSPC/…) lands in the check output, not a dead container path.
    expect(sb.runs[0]?.command[2]).toContain('2>&1');
    expect(sb.runs[0]?.command[2]).toContain('_logs');
    expect(sb.runs[1]?.network).toBe('none'); // build: stays offline
    expect(sb.runs[1]?.tmpfsSize).toBe('512m'); // build: Angular spills past the 64m default /tmp
  });

  it('records FAILED with the [deps]-tagged log when the install fails (build never runs)', async () => {
    const dir = workdirWithManifest();
    const sb = new ScriptedSandbox([result({ exitCode: 1, stderr: 'npm ERR! 404 Not Found' })]);
    const r = new SandboxRunner({
      sandbox: sb,
      image: 'harness-verify:node20',
      limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 60 },
    });

    const checkResult = await new CloneCompileCheck(r).run(dir);

    expect(checkResult.status).toBe(CheckStatus.FAILED);
    expect(checkResult.output).toContain('[deps]');
    expect(checkResult.output).toContain('404 Not Found');
    expect(sb.runs).toHaveLength(1); // install only, no build attempt
  });

  it('opts out of the install with installDependencies: false', async () => {
    const dir = workdirWithManifest();
    const sb = new ScriptedSandbox([result()]);
    const r = new SandboxRunner({
      sandbox: sb,
      image: 'harness-verify:node20',
      limits: { cpu: '1.0', memory: '512m', timeoutSeconds: 60 },
      installDependencies: false,
    });

    await new CloneCompileCheck(r).run(dir);

    expect(sb.runs).toHaveLength(1);
    expect(sb.runs[0]?.network).toBe('none');
  });
});

describe('parsePackageScripts', () => {
  it('extracts build/test script names', () => {
    expect(parsePackageScripts(JSON.stringify({ scripts: { build: 'tsc -p .', test: 'vitest' } }))).toEqual({
      build: 'tsc -p .',
      test: 'vitest',
    });
  });

  it('degrades to {} for malformed JSON, missing scripts, or non-string values', () => {
    expect(parsePackageScripts('not json')).toEqual({});
    expect(parsePackageScripts(JSON.stringify({}))).toEqual({});
    expect(parsePackageScripts(JSON.stringify({ scripts: { build: 42 } }))).toEqual({});
  });
});
