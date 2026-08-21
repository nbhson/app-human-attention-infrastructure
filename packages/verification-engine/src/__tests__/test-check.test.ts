import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { brand } from '@harness/domain';
import { describe, expect, it } from 'vitest';

import { TestCheck } from '../checks/test-check.js';
import type { VitestRun } from '../checks/test-check.js';
import { CheckStatus } from '../types.js';
import type { CheckContext } from '../types.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));

function context(worktreePath: string): CheckContext {
  return {
    changeId: brand('change-1', 'ChangeID'),
    worktreePath,
    sandboxRoot: FIXTURES,
  };
}

const TEST_FILE = '/worktree/src/add.test.ts';

function passRun(): VitestRun {
  return {
    code: 0,
    output: 'Test Files 1 passed (1)',
    results: [{ testFile: TEST_FILE, testName: 'add > ok', status: 'PASSED', durationMs: 1 }],
    timedOut: false,
  };
}

function failRun(): VitestRun {
  return {
    code: 1,
    output: 'Test Files 1 failed (1)',
    results: [
      {
        testFile: TEST_FILE,
        testName: 'add > boom',
        status: 'FAILED',
        durationMs: 2,
        error: 'AssertionError',
      },
    ],
    timedOut: false,
  };
}

function timedOutRun(): VitestRun {
  return { code: null, output: '...[test timed out]', results: [], timedOut: true };
}

/**
 * Deterministic subclass that scripts `runVitest` so the retry/status logic is
 * tested without invoking a real (nested) Vitest — no flaky OS timing.
 */
class FakeTestCheck extends TestCheck {
  readonly invocations: VitestRun[] = [];

  constructor(private readonly script: VitestRun[]) {
    super(60_000);
  }

  protected override runVitest(_ctx: CheckContext): Promise<VitestRun> {
    void _ctx;
    const next = this.script[this.invocations.length] ?? this.script[this.script.length - 1]!;
    this.invocations.push(next);
    return Promise.resolve(next);
  }
}

describe('TestCheck', () => {
  it('passes on the first run without retrying', async () => {
    const check = new FakeTestCheck([passRun()]);
    const result = await check.run(context(FIXTURES));
    expect(result.status).toBe(CheckStatus.PASSED);
    expect(result.testResults).toEqual(passRun().results);
    expect(check.invocations).toHaveLength(1);
  });

  it('reports FLAKY when a failed first run passes on retry', async () => {
    const check = new FakeTestCheck([failRun(), passRun()]);
    const result = await check.run(context(FIXTURES));
    expect(result.status).toBe(CheckStatus.FLAKY);
    expect(result.retried).toBe(true);
    expect(result.testResults).toEqual(passRun().results);
    expect(check.invocations).toHaveLength(2);
  });

  it('reports FAILED with the first failure when the retry also fails', async () => {
    const check = new FakeTestCheck([failRun(), failRun()]);
    const result = await check.run(context(FIXTURES));
    expect(result.status).toBe(CheckStatus.FAILED);
    expect(result.retried).toBe(true);
    expect(result.output).toBe(failRun().output);
    expect(check.invocations).toHaveLength(2);
  });

  it('reports TIMED_OUT and never runs a third time when both attempts hang', async () => {
    const check = new FakeTestCheck([timedOutRun(), timedOutRun()]);
    const result = await check.run(context(FIXTURES));
    expect(result.status).toBe(CheckStatus.TIMED_OUT);
    expect(check.invocations).toHaveLength(2);
  });
});

// --- Real process-group kill (day-16 §2.1, §2.5) -------------------------

/** A synthetic "vitest" that hangs forever and leaks a grandchild into its group. */
const FAKE_VITEST_SOURCE = `
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
console.log('PARENT_PID=' + process.pid);
console.log('GC_PID=' + child.pid);
setInterval(() => {}, 1000);
`;

async function waitUntilGone(pid: number, deadlineMs = 2000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return; // ESRCH: the PID is no longer alive.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`process ${pid} still alive after ${deadlineMs}ms`);
}

describe('TestCheck process-group kill', () => {
  it('kills the whole group (parent + leaked grandchild) on level-1 timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'testcheck-kill-'));
    const bin = join(dir, 'fake-vitest.mjs');
    writeFileSync(bin, FAKE_VITEST_SOURCE);

    const check = new TestCheck(200, bin);
    const result = await check.run(context(dir));

    expect(result.status).toBe(CheckStatus.TIMED_OUT);
    // The timeout branch returns the retry's output, which echoes both PIDs.
    const parentPid = Number(/PARENT_PID=(\d+)/.exec(result.output)?.[1]);
    const childPid = Number(/GC_PID=(\d+)/.exec(result.output)?.[1]);
    expect(parentPid).toBeGreaterThan(0);
    expect(childPid).toBeGreaterThan(0);

    await waitUntilGone(parentPid);
    await waitUntilGone(childPid);
  }, 10_000);
});
