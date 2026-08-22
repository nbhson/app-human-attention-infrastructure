/**
 * `SandboxedToolExecutor` (day-23 §2.1) — the Code-Mode surface over the shared
 * {@link Sandbox} from Day 22.
 *
 * Verification (Day 22) and generation (today) now share *one* sandbox. This
 * class is not a second runtime: it composes the existing sandbox with
 * Code-Mode-specific *policy* — tool tiers (read-only vs constrained write vs
 * auth-gated), per-tool/per-task rate limits, and a session record — so
 * generated code cannot touch the orchestration process or its filesystem.
 *
 * Each method builds a {@link SandboxRun} whose `workspaceWritable` flag is
 * derived from the tool's tier (day-23 §2.2): tier 0 → read-only mount, tier
 * 1+ → the single writable workspace mount, with `network: 'none'` and the
 * read-only rootfs always in force (those invariants live in `DockerSandbox`,
 * in exactly one place).
 */

import { computeWorkdirManifest } from '@harness/sandbox';
import type { Sandbox, SandboxLimits, SandboxResult, SandboxRun } from '@harness/sandbox';
import type { TaskID } from '@harness/domain';
import type { CodeModePolicy, CodeModeToolCall } from '@harness/db';

import type { CodeModeSessionWriter } from './code-mode-session.js';
import type { RateLimiter } from './rate-limiter.js';
import { assertTierAllowed, DEFAULT_TOOL_TIERS, writesWorkspace } from './tiers.js';
import { resolveSafe } from '../tools/resolve-safe.js';

/** The measured outcome of one sandboxed tool call, mapped from a `SandboxResult`. */
export interface ToolResult {
  readonly tool: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** Capped stdout + stderr from the container (the tool's observation). */
  readonly output: string;
}

export interface SandboxedToolExecutorOptions {
  readonly sandbox: Sandbox;
  readonly rateLimiter: RateLimiter;
  readonly sessions: CodeModeSessionWriter;
  /** The pinned image (shared with verification — day-23 §2.1). */
  readonly image: string;
  /** Host directory mounted at `/workdir`. */
  readonly workdirPath: string;
  readonly limits: SandboxLimits;
  /** The tier + rate-limit policy recorded on the session (§2.4). */
  readonly policy: CodeModePolicy;
  /** Whether tier-2 (auth-gated) tools are approved this run. Defaults false. */
  readonly approved?: boolean;
}

/** Quote a path for a POSIX shell single-quoted string. */
function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** A tool name whose tier carries the default tiered caps. */
const DEFAULT_RATE_LIMITS: Readonly<Record<string, number>> = {
  write_file: 50,
  run_test: 20,
  run_command: 10,
  git_push: 5,
};

/** The default Code-Mode policy (tiers from `tiers.ts` + per-tool call ceilings). */
export const CODE_MODE_POLICY_V1: CodeModePolicy = {
  tiers: { ...DEFAULT_TOOL_TIERS },
  maxCallsPerTask: { ...DEFAULT_RATE_LIMITS },
};

export class SandboxedToolExecutor {
  private readonly activeSessions = new Map<TaskID, string>();

  constructor(private readonly opts: SandboxedToolExecutorOptions) {}

  /** Write content to a workspace-relative path (tier 1). */
  async writeFile(taskId: TaskID, relPath: string, content: string): Promise<ToolResult> {
    resolveSafe(this.opts.workdirPath, relPath); // reject `..` / absolute escapes
    const target = `/workdir/${relPath}`;
    const command = [
      'bash',
      '-lc',
      `mkdir -p "$(dirname ${shQuote(target)})" && cat > ${shQuote(target)} <<'HARNESS_EOF'\n${content}\nHARNESS_EOF`,
    ];
    return this.execute(taskId, 'write_file', command);
  }

  /** Read a workspace-relative path (tier 0). */
  async readFile(taskId: TaskID, relPath: string): Promise<ToolResult> {
    resolveSafe(this.opts.workdirPath, relPath);
    return this.execute(taskId, 'read_file', [
      'bash',
      '-lc',
      `cat ${shQuote(`/workdir/${relPath}`)}`,
    ]);
  }

  /** Run an arbitrary command (tier 2 — auth-gated). */
  async runCommand(taskId: TaskID, command: string): Promise<ToolResult> {
    return this.execute(taskId, 'run_command', ['bash', '-lc', command]);
  }

  /** Run the workspace test suite (tier 1). */
  async runTest(taskId: TaskID): Promise<ToolResult> {
    return this.execute(taskId, 'run_test', ['bash', '-lc', 'cd /workdir && vitest run']);
  }

  /** Finalize a task's session (stamps `ended_at`). */
  async endSession(taskId: TaskID): Promise<void> {
    const sessionId = this.activeSessions.get(taskId);
    if (sessionId) {
      await this.opts.sessions.end(sessionId);
      this.activeSessions.delete(taskId);
    }
  }

  /** Resolve (or begin) the task's session, pinning the workspace bytes once. */
  private async ensureSession(taskId: TaskID): Promise<string> {
    const existing = this.activeSessions.get(taskId);
    if (existing) {
      return existing;
    }
    const { contentHash } = await computeWorkdirManifest(this.opts.workdirPath);
    const id = await this.opts.sessions.begin(taskId, contentHash, this.opts.policy);
    this.activeSessions.set(taskId, id);
    return id;
  }

  /** The shared path: enforce tier, rate-limit, run, and record (day-23 §3). */
  private async execute(taskId: TaskID, tool: string, command: string[]): Promise<ToolResult> {
    // The ejector seat: a tier-2 tool without approval throws before any
    // container is allocated (day-23 §6).
    assertTierAllowed(tool, this.opts.approved === true);

    const sessionId = await this.ensureSession(taskId);
    const { files } = await computeWorkdirManifest(this.opts.workdirPath);
    const writable = writesWorkspace(tool);

    const run: SandboxRun = {
      command,
      image: this.opts.image,
      workdirPath: this.opts.workdirPath,
      workdirContents: files,
      limits: this.opts.limits,
      network: 'none',
      ...(writable ? { workspaceWritable: true } : {}),
    };

    const result: SandboxResult = await this.opts.rateLimiter.throttle(tool, () =>
      this.opts.sandbox.run(run),
    );

    const call: CodeModeToolCall = {
      tool,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
    await this.opts.sessions.record(sessionId, call);

    return {
      tool,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      output: `${result.stdout}${result.stderr}`.trim(),
    };
  }
}
