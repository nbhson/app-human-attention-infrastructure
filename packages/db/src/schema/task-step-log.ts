import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';

/**
 * Per-step audit trail for a workflow run (day-09 §2.3).
 *
 * The runner inserts a `STARTED` row *before* invoking a step handler and
 * updates it to `COMPLETED`/`FAILED` after — so a process crash mid-step leaves
 * the `STARTED` row behind and shows exactly which step was in flight.
 *
 * `status` (`STARTED`/`COMPLETED`/`FAILED`) and `step_kind` (`StepKind`) are
 * plain `text` like `task_state_history` (day-06): their allowed values are
 * Orchestrator-owned, not a `@harness/domain` const, so there is no CHECK here.
 */
export const taskStepLog = pgTable('task_step_log', {
  id: text('id').primaryKey(),
  task_id: text('task_id')
    .notNull()
    .references(() => tasks.id),
  workflow_id: text('workflow_id').notNull(),
  workflow_ver: integer('workflow_ver').notNull(),
  step_index: integer('step_index').notNull(),
  step_kind: text('step_kind').notNull(),
  status: text('status').notNull(),
  output: jsonb('output'),
  started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finished_at: timestamp('finished_at', { withTimezone: true }),
});
