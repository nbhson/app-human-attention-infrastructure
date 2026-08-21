import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';

/**
 * Dispatch idempotency log (day-08 §2.3). One row per dispatch of a task
 * attempt. `idempotency_key` is `task_id + ":" + attempt_number` and is unique,
 * so a duplicate dispatch is a silent no-op instead of a second transition.
 *
 * Append-only like `event_log`: the `Dispatcher` never UPDATEs or DELETEs here.
 */
export const dispatchLog = pgTable('dispatch_log', {
  id: text('id').primaryKey(),
  task_id: text('task_id')
    .notNull()
    .references(() => tasks.id),
  attempt_number: integer('attempt_number').notNull(),
  idempotency_key: text('idempotency_key').notNull().unique(),
  dispatched_at: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
});
