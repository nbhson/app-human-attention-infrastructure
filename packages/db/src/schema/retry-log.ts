import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';

/**
 * Retry audit trail (day-10 §2.4). One row per *retry* — a failed step attempt
 * the {@link import('@harness/orchestrator').WorkflowRunner} decided to retry
 * before escalating. `delay_ms` records the backoff that was applied
 * (`computeDelay`), and `failure_class` carries the `FailureClass` the attempt
 * was classified as (`TRANSIENT`/`PERMANENT`/`RESOURCE`).
 *
 * No natural key: each retry is a distinct event and must be preserved as such
 * (day-10 §2.5). `attempt_number` is the runner's *per-step* counter, not the
 * task-level `tasks.attempt_number` (which tracks full REWORK cycles).
 */
export const retryLog = pgTable('retry_log', {
  id: text('id').primaryKey(),
  task_id: text('task_id')
    .notNull()
    .references(() => tasks.id),
  step_index: integer('step_index').notNull(),
  attempt_number: integer('attempt_number').notNull(),
  failure_class: text('failure_class').notNull(),
  error_message: text('error_message').notNull(),
  delay_ms: integer('delay_ms').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
