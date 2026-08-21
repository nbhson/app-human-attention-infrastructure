import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { agentRunStatusCheck } from './enums.js';
import { tasks } from './tasks.js';

/** One row per agent execution attempt (agent-runtime spec). */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    // Task lifecycle id (== tasks.id in Phase 1) so a run joins its task's
    // correlated rows across llm_call_log / event_log (day-27 §2.2).
    correlation_id: text('correlation_id'),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id),
    attempt_number: integer('attempt_number').notNull().default(0),
    status: text('status').notNull(),
    started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finished_at: timestamp('finished_at', { withTimezone: true }),
    max_steps: integer('max_steps').notNull(),
    steps_used: integer('steps_used').notNull().default(0),
    // How far the loop got (day-12 §6: crash visibility).
    current_step: integer('current_step').notNull().default(0),
    // Populated when status = 'ESCALATED' (MAX_STEPS_EXCEEDED | TOKEN_BUDGET_EXCEEDED).
    escalation_reason: text('escalation_reason'),
  },
  () => [agentRunStatusCheck],
);
