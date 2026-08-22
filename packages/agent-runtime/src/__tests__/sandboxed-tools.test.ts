/**
 * day-23 §3.5 / §3.6 — the `SandboxedToolExecutor` composes the shared sandbox
 * with Code-Mode policy (tiers, rate limits, session record).
 *
 * The matrix asserted here is the §3.6 table:
 *   - tier 0 tools → read-only mount (`workspaceWritable` absent)
 *   - tier 1 tools → the single writable workspace mount (`workspaceWritable: true`)
 *   - every run → `network: 'none'`
 *   - out-of-workspace path → `PATH_TRAVERSAL_REJECTED`, no container allocated
 *   - tier 2 without approval → `ToolApprovalRequiredError`, no container allocated
 *   - count ceiling → `ToolRateLimitError`
 *   - session record → `workspace_content_hash` + append-only `tool_calls`
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newTaskID } from '@harness/domain';
import { computeWorkdirManifest } from '@harness/sandbox';
import type { Sandbox, SandboxLimits, SandboxResult, SandboxRun } from '@harness/sandbox';

import { InMemoryCodeModeSessionWriter } from '../code-mode/code-mode-session.js';
import { PerToolRateLimiter, ToolRateLimitError } from '../code-mode/rate-limiter.js';
import { CODE_MODE_POLICY_V1, SandboxedToolExecutor } from '../code-mode/sandboxed-tools.js';
import type { RateLimiter } from '../code-mode/rate-limiter.js';
import { ToolApprovalRequiredError } from '../code-mode/tiers.js';

const OK: SandboxResult = { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 7 };
const LIMITS: SandboxLimits = { cpu: '1.0', memory: '512m', timeoutSeconds: 30 };

/** A fake sandbox that records every `SandboxRun` and returns scripted results. */
class RecordingSandbox implements Sandbox {
  readonly runs: SandboxRun[] = [];
  private readonly results: SandboxResult[];

  constructor(results: SandboxResult[] = []) {
    this.results = results;
  }

  async run(run: SandboxRun): Promise<SandboxResult> {
    this.runs.push(run);
    return this.results.shift() ?? OK;
  }
}

function makeExecutor(
  sandbox: Sandbox,
  options: { approved?: boolean; rateLimiter?: RateLimiter } = {},
): { executor: SandboxedToolExecutor; writer: InMemoryCodeModeSessionWriter } {
  const writer = new InMemoryCodeModeSessionWriter();
  const rateLimiter =
    options.rateLimiter ??
    new PerToolRateLimiter(
      Object.fromEntries(
        Object.entries(CODE_MODE_POLICY_V1.maxCallsPerTask).map(([tool, maxCallsPerTask]) => [
          tool,
          { maxCallsPerTask, maxConcurrent: 4 },
        ]),
      ),
    );
  const executor = new SandboxedToolExecutor({
    sandbox,
    rateLimiter,
    sessions: writer,
    image: 'harness-verify:node20',
    workdirPath: root,
    limits: LIMITS,
    policy: CODE_MODE_POLICY_V1,
    ...(options.approved === undefined ? {} : { approved: options.approved }),
  });
  return { executor, writer };
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hai-codemode-'));
  await writeFile(join(root, 'seed.txt'), 'seed');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('SandboxedToolExecutor', () => {
  const taskId = newTaskID();

  it('runs tier-0 read_file with a read-only mount and network none', async () => {
    const sandbox = new RecordingSandbox();
    const { executor } = makeExecutor(sandbox);

    await executor.readFile(taskId, 'seed.txt');

    const run = sandbox.runs[0]!;
    expect(run.network).toBe('none');
    expect(run.workspaceWritable).toBeUndefined();
    expect(run.command[2]).toContain('seed.txt');
  });

  it('runs tier-1 write_file with workspaceWritable: true and no network', async () => {
    const sandbox = new RecordingSandbox();
    const { executor } = makeExecutor(sandbox);

    await executor.writeFile(taskId, 'a.txt', 'hello');

    const run = sandbox.runs[0]!;
    expect(run.workspaceWritable).toBe(true);
    expect(run.network).toBe('none');
    expect(run.command[2]).toContain('hello');
  });

  it('rejects an out-of-workspace path before allocating a container', async () => {
    const sandbox = new RecordingSandbox();
    const { executor } = makeExecutor(sandbox);

    await expect(executor.writeFile(taskId, '../secret.txt', 'x')).rejects.toThrow(
      /PATH_TRAVERSAL_REJECTED/,
    );
    await expect(executor.readFile(taskId, '/etc/passwd')).rejects.toThrow(
      /PATH_TRAVERSAL_REJECTED/,
    );
    expect(sandbox.runs).toHaveLength(0);
  });

  it('refuses a tier-2 run_command without approval, allocating nothing', async () => {
    const sandbox = new RecordingSandbox();
    const { executor } = makeExecutor(sandbox);

    await expect(executor.runCommand(taskId, 'whoami')).rejects.toBeInstanceOf(
      ToolApprovalRequiredError,
    );
    expect(sandbox.runs).toHaveLength(0);
  });

  it('permits a tier-2 tool once approved', async () => {
    const sandbox = new RecordingSandbox();
    const { executor } = makeExecutor(sandbox, { approved: true });

    const result = await executor.runCommand(taskId, 'whoami');
    expect(result.tool).toBe('run_command');
    expect(sandbox.runs).toHaveLength(1);
    expect(sandbox.runs[0]!.workspaceWritable).toBe(true); // tier 2 is also writable
  });

  it('rejects write_file beyond its per-task ceiling', async () => {
    const sandbox = new RecordingSandbox();
    const { executor } = makeExecutor(sandbox, {
      rateLimiter: new PerToolRateLimiter({
        write_file: { maxCallsPerTask: 1, maxConcurrent: 4 },
        run_test: { maxCallsPerTask: 20, maxConcurrent: 4 },
        run_command: { maxCallsPerTask: 10, maxConcurrent: 4 },
        git_push: { maxCallsPerTask: 5, maxConcurrent: 4 },
      }),
    });

    await executor.writeFile(taskId, 'a.txt', 'hello');
    await expect(executor.writeFile(taskId, 'b.txt', 'world')).rejects.toBeInstanceOf(
      ToolRateLimitError,
    );
    expect(sandbox.runs).toHaveLength(1);
  });

  it('records a session pinning the workspace hash and append-only tool calls', async () => {
    const sandbox = new RecordingSandbox();
    const { executor, writer } = makeExecutor(sandbox);

    await executor.writeFile(taskId, 'a.txt', 'hello');
    await executor.readFile(taskId, 'a.txt');

    const session = [...writer.sessions.values()][0];
    expect(session).toBeDefined();
    expect(session!.taskId).toBe(taskId);
    expect(session!.toolCalls.map((c) => c.tool)).toEqual(['write_file', 'read_file']);
    expect(session!.toolCalls[0]!.exitCode).toBe(0);

    const { contentHash } = await computeWorkdirManifest(root);
    expect(session!.workspaceContentHash).toBe(contentHash);
  });

  it('maps a sandbox result into a capped, trimmed ToolResult', async () => {
    const sandbox = new RecordingSandbox([
      { exitCode: 1, stdout: 'out\n', stderr: 'err\n', timedOut: false, durationMs: 3 },
    ]);
    const { executor } = makeExecutor(sandbox);

    const result = await executor.writeFile(taskId, 'a.txt', 'hello');

    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBe(3);
    expect(result.output).toBe('out\nerr');
  });
});
