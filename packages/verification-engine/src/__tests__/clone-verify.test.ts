import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SandboxInfraError } from '@harness/sandbox';
import type { Sandbox, SandboxResult, SandboxRun } from '@harness/sandbox';
import { describe, expect, it } from 'vitest';

import { CloneCompileCheck } from '../clone-checks/compile-check.js';
import { CloneTestCheck } from '../clone-checks/test-check.js';
import { CloneVerifier } from '../clone-verifier.js';
import type { CloneWorktree } from '../clone-verifier.js';
import { parsePackageScripts, resolvePackageScripts, SandboxRunner } from '../sandbox-runner.js';
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
