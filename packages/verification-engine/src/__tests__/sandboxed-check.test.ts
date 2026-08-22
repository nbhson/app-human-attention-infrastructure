import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { brand } from '@harness/domain';
import type { Logger } from '@harness/di';
import { SandboxInfraError } from '@harness/sandbox';
import type { Sandbox, SandboxResult, SandboxRun } from '@harness/sandbox';
import { describe, expect, it } from 'vitest';

import { CompileCheck } from '../checks/compile-check.js';
import { SandboxedCheck } from '../executors/sandboxed-check.js';
import { CheckKind, CheckStatus } from '../types.js';
import type { CheckContext, VerificationCheck } from '../types.js';

const require = createRequire(import.meta.url);
const TSC_BIN = require.resolve('typescript/bin/tsc');

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));

function context(worktreePath: string): CheckContext {
  return {
    changeId: brand('change-1', 'ChangeID'),
    worktreePath,
    sandboxRoot: FIXTURES,
  };
}

const LIMITS = { cpu: '1.0', memory: '512m', timeoutSeconds: 60 };

function result(overrides: Partial<SandboxResult>): SandboxResult {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 3, ...overrides };
}

/** A `Sandbox` with a fixed outcome (result or thrown error). */
class FixedSandbox implements Sandbox {
  constructor(private readonly outcome: SandboxResult | Error) {}

  run(): Promise<SandboxResult> {
    if (this.outcome instanceof Error) {
      return Promise.reject(this.outcome);
    }
    return Promise.resolve(this.outcome);
  }
}

/** Runs the command locally (ignores isolation) — used only to prove parity. */
class ProcessSandbox implements Sandbox {
  run(run: SandboxRun): Promise<SandboxResult> {
    return new Promise((resolve) => {
      const [bin, ...rest] = run.command;
      if (bin === undefined) {
        resolve(result({ exitCode: 127, stderr: 'empty command' }));
        return;
      }
      const started = Date.now();
      const proc = spawn(bin, rest, { cwd: run.workdirPath });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      proc.on('error', (error) => resolve(result({ exitCode: 127, stderr: String(error) })));
      proc.on('close', (code) =>
        resolve(
          result({ exitCode: code ?? 137, stdout, stderr, durationMs: Date.now() - started }),
        ),
      );
    });
  }
}

function innerPassing(): VerificationCheck {
  return {
    kind: CheckKind.COMPILE,
    timeoutMs: 60_000,
    run: async () => ({
      checkKind: CheckKind.COMPILE,
      status: CheckStatus.PASSED,
      durationMs: 5,
      output: 'in-process ok',
    }),
  };
}

describe('SandboxedCheck (day-22 §3.3)', () => {
  it('maps exit 0 to PASSED', async () => {
    const check = new SandboxedCheck({
      inner: innerPassing(),
      sandbox: new FixedSandbox(result({ exitCode: 0, stdout: 'compiled' })),
      image: 'harness-verify:node20',
      buildCommand: () => ['bash', '-lc', 'tsc'],
      limits: LIMITS,
    });
    const r = await check.run(context(`${FIXTURES}/compile-pass`));
    expect(r.status).toBe(CheckStatus.PASSED);
    expect(r.output).toContain('compiled');
  });

  it('maps a non-zero exit to FAILED and carries stderr', async () => {
    const check = new SandboxedCheck({
      inner: innerPassing(),
      sandbox: new FixedSandbox(result({ exitCode: 2, stderr: 'TS2322: boom' })),
      image: 'harness-verify:node20',
      buildCommand: () => ['bash', '-lc', 'tsc'],
      limits: LIMITS,
    });
    const r = await check.run(context(`${FIXTURES}/compile-fail`));
    expect(r.status).toBe(CheckStatus.FAILED);
    expect(r.output).toContain('TS2322: boom');
  });

  it('maps timedOut to TIMED_OUT', async () => {
    const check = new SandboxedCheck({
      inner: innerPassing(),
      sandbox: new FixedSandbox(result({ exitCode: 137, timedOut: true, stderr: 'killed' })),
      image: 'harness-verify:node20',
      buildCommand: () => ['bash', '-lc', 'tsc'],
      limits: LIMITS,
    });
    const r = await check.run(context(`${FIXTURES}/compile-pass`));
    expect(r.status).toBe(CheckStatus.TIMED_OUT);
  });

  it('falls back to the in-process check on SandboxInfraError, logging a warning', async () => {
    const warns: string[] = [];
    const logger: Logger = {
      debug: () => {},
      info: () => {},
      error: () => {},
      warn: (message) => {
        warns.push(message);
      },
      child: () => logger,
    };

    const check = new SandboxedCheck({
      inner: innerPassing(),
      sandbox: new FixedSandbox(new SandboxInfraError('Cannot connect to the Docker daemon')),
      image: 'harness-verify:node20',
      buildCommand: () => ['bash', '-lc', 'tsc'],
      limits: LIMITS,
      logger,
    });

    const r = await check.run(context(`${FIXTURES}/compile-pass`));
    expect(r.status).toBe(CheckStatus.PASSED);
    expect(r.output).toBe('in-process ok');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('falling back');
  });

  it('rejects a redirect-reentrant fallback (inner is itself a SandboxedCheck)', () => {
    const nested = new SandboxedCheck({
      inner: innerPassing(),
      sandbox: new FixedSandbox(result({ exitCode: 0 })),
      image: 'harness-verify:node20',
      buildCommand: () => ['bash', '-lc', 'tsc'],
      limits: LIMITS,
    });

    expect(
      () =>
        new SandboxedCheck({
          inner: nested,
          sandbox: new FixedSandbox(new SandboxInfraError('Cannot connect to the Docker daemon')),
          image: 'harness-verify:node20',
          buildCommand: () => ['bash', '-lc', 'tsc'],
          limits: LIMITS,
        }),
    ).toThrow(/redirect-reentrant/);
  });

  it('parity: sandboxed and in-process verdicts agree on the same fixtures', async () => {
    const inner = new CompileCheck(60_000);
    const sandboxed = new SandboxedCheck({
      inner,
      sandbox: new ProcessSandbox(),
      image: 'harness-verify:node20',
      // Host command (the ProcessSandbox ignores the image) — resolves tsc the
      // same way the in-process CompileCheck does.
      buildCommand: (ctx) => [process.execPath, TSC_BIN, '--noEmit', '-p', ctx.worktreePath],
      limits: LIMITS,
    });

    for (const fixture of ['compile-pass', 'compile-fail']) {
      const worktree = `${FIXTURES}/${fixture}`;
      const inProcess = await inner.run(context(worktree));
      const inSandbox = await sandboxed.run(context(worktree));

      expect(inSandbox.status, fixture).toBe(inProcess.status);
    }
  }, 30_000);
});
