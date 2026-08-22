/**
 * Code-Mode session record — the tamper-evident trail of sandboxed execution
 * (day-23 §2.4 / Spec 9 §3.2).
 *
 * A session pins the bytes the agent operated on (`workspace_content_hash`),
 * the policy in force, and the append-only `tool_calls` log. Together with the
 * per-tool exit code/timedOut/duration, "what ran, on what bytes, under what
 * policy" is answerable — the same attributability Day 22 gave verification.
 *
 * The writer is a narrow seam so the executor stays testable without Postgres:
 * {@link DbCodeModeSessionWriter} is the real persistence, and
 * {@link InMemoryCodeModeSessionWriter} exists for unit tests.
 */

import { eq } from 'drizzle-orm';

import { uuidv7 } from '@harness/domain';
import type { TaskID } from '@harness/domain';
import { codeModeSessions } from '@harness/db';
import type { CodeModePolicy, CodeModeToolCall, DrizzleDB } from '@harness/db';

/** The append-only persistence seam for a code-mode session. */
export interface CodeModeSessionWriter {
  /** Create a session pinning the workspace hash + policy; returns its id. */
  begin(taskId: TaskID, workspaceContentHash: string, policy: CodeModePolicy): Promise<string>;
  /** Append one tool-call record (never rewrite existing entries). */
  record(sessionId: string, call: CodeModeToolCall): Promise<void>;
  /** Stamp the session `ended_at`. */
  end(sessionId: string): Promise<void>;
}

/** The Postgres-backed writer (`code_mode_sessions`). */
export class DbCodeModeSessionWriter implements CodeModeSessionWriter {
  constructor(private readonly db: DrizzleDB) {}

  async begin(
    taskId: TaskID,
    workspaceContentHash: string,
    policy: CodeModePolicy,
  ): Promise<string> {
    const id = uuidv7();
    await this.db.insert(codeModeSessions).values({
      id,
      task_id: taskId,
      workspace_content_hash: workspaceContentHash,
      tool_calls: [],
      policy,
    });
    return id;
  }

  async record(sessionId: string, call: CodeModeToolCall): Promise<void> {
    const rows = await this.db
      .select({ calls: codeModeSessions.tool_calls })
      .from(codeModeSessions)
      .where(eq(codeModeSessions.id, sessionId));
    const current = rows[0]?.calls ?? [];
    await this.db
      .update(codeModeSessions)
      .set({ tool_calls: [...current, call] })
      .where(eq(codeModeSessions.id, sessionId));
  }

  async end(sessionId: string): Promise<void> {
    await this.db
      .update(codeModeSessions)
      .set({ ended_at: new Date() })
      .where(eq(codeModeSessions.id, sessionId));
  }
}

/** A `CodeModeSessionWriter` that keeps sessions in memory (unit tests). */
export class InMemoryCodeModeSessionWriter implements CodeModeSessionWriter {
  readonly sessions = new Map<
    string,
    {
      taskId: TaskID;
      workspaceContentHash: string;
      policy: CodeModePolicy;
      toolCalls: CodeModeToolCall[];
    }
  >();

  private seq = 0;

  async begin(
    taskId: TaskID,
    workspaceContentHash: string,
    policy: CodeModePolicy,
  ): Promise<string> {
    const id = `session-${++this.seq}`;
    this.sessions.set(id, { taskId, workspaceContentHash, policy, toolCalls: [] });
    return id;
  }

  async record(sessionId: string, call: CodeModeToolCall): Promise<void> {
    this.sessions.get(sessionId)?.toolCalls.push(call);
  }

  async end(_sessionId: string): Promise<void> {
    // Ended marker is not asserted in unit tests; a no-op keeps the seam uniform.
    void _sessionId;
  }
}
