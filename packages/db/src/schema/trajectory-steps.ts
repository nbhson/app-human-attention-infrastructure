import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { agentRuns } from './agent-runs.js';

/**
 * The per-step audit trail of an agent run (day-13 §2.3): one row per
 * {@link import('@harness/agent-runtime').ReActStep}, recorded in real time by
 * the TrajectoryRecorder while the loop runs. `thought` / `tool_name` /
 * `tool_input` / `observation` are nullable — a final-answer step has no tool
 * call, and a model may call a tool with no reasoning text (`thought = ''`).
 *
 * `tool_input` is stored as native `jsonb` (never pre-serialised to a string).
 */
export const trajectorySteps = pgTable('trajectory_steps', {
  id: text('id').primaryKey(),
  agent_run_id: text('agent_run_id')
    .notNull()
    .references(() => agentRuns.id),
  step_number: integer('step_number').notNull(),
  thought: text('thought'),
  tool_name: text('tool_name'),
  tool_input: jsonb('tool_input'),
  observation: text('observation'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
