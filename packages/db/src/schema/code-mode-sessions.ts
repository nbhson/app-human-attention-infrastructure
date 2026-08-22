import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';

/**
 * One sandboxed code-mode tool invocation, recorded append-only into a
 * session's `tool_calls` (day-23 §2.4 / Spec 9 §3.2). Every field is a
 * post-hoc fact — nothing here is mutable once written.
 */
export interface CodeModeToolCall {
  /** The tool name, e.g. `write_file`, `run_test`. */
  readonly tool: string;
  /** Container exit code (`137` when killed). */
  readonly exitCode: number;
  /** True when the container was killed for exceeding its time budget. */
  readonly timedOut: boolean;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
}

/**
 * The tool-tier + rate-limit policy in force for a session (day-23 §2.2, §2.3).
 * Persisted on the session row so "under what policy" is answerable later.
 */
export interface CodeModePolicy {
  /** Tool name → tier (0 read-only, 1 constrained write, 2 auth-gated). */
  readonly tiers: Record<string, number>;
  /** Tool name → per-task call ceiling. */
  readonly maxCallsPerTask: Record<string, number>;
}

/**
 * The tamper-evident trail of a Code-Mode session (day-23 §2.4): the bytes the
 * session operated on (`workspace_content_hash`), the policy in force, an ended
 * marker, and the append-only `tool_calls` log. Together these make "what ran,
 * on what bytes, under what policy" answerable — the same attributability Day 22
 * gave verification.
 */
export const codeModeSessions = pgTable('code_mode_sessions', {
  id: text('id').primaryKey(),
  task_id: text('task_id')
    .notNull()
    .references(() => tasks.id),
  started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  ended_at: timestamp('ended_at', { withTimezone: true }),
  // SHA-256 of the workspace manifest at session start — pins the environment.
  workspace_content_hash: text('workspace_content_hash').notNull(),
  tool_calls: jsonb('tool_calls').notNull().$type<CodeModeToolCall[]>().default([]),
  policy: jsonb('policy').notNull().$type<CodeModePolicy>(),
});
