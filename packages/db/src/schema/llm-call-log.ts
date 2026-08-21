import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { agentRuns } from './agent-runs.js';

/**
 * LLM call provenance log (day-11 §2.5). One row per model request/response,
 * written by `LoggingLLMProvider` *after* the call so a task's full
 * model-guidance trail is recoverable later.
 *
 * `agent_run_id` is nullable until Day 12 (when `AgentRun` exists); null rows
 * are valid provenance for pre-runtime calls and must not be backfilled
 * (day-11 §6).
 *
 * `request_hash` is a SHA-256 of the serialised request — a dedup key for
 * spotting identical retries, not a secret (day-11 §6).
 */
export const llmCallLog = pgTable('llm_call_log', {
  id: text('id').primaryKey(),
  agent_run_id: text('agent_run_id').references(() => agentRuns.id),
  model: text('model').notNull(),
  input_tokens: integer('input_tokens').notNull(),
  output_tokens: integer('output_tokens').notNull(),
  stop_reason: text('stop_reason').notNull(),
  request_hash: text('request_hash').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
