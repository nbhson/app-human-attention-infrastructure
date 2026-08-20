import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { agentRunStatusCheck } from './enums.js';
import { tasks } from './tasks.js';

/** One row per agent execution attempt (agent-runtime spec). */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id),
    attempt_number: integer('attempt_number').notNull().default(0),
    status: text('status').notNull(),
    started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finished_at: timestamp('finished_at', { withTimezone: true }),
    max_steps: integer('max_steps').notNull(),
    steps_used: integer('steps_used').notNull().default(0),
  },
  () => [agentRunStatusCheck],
);
