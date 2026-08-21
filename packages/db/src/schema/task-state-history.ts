import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';

/**
 * Append-only audit trail of every task state transition (day-06 §2.3).
 *
 * `tasks` is the current-state projection; this table is the typed, pre-joined
 * history that provenance (day-26) and observability (day-27) read from, rather
 * than re-deriving from `event_log`.
 */
export const taskStateHistory = pgTable(
  'task_state_history',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id),
    from_state: text('from_state').notNull(),
    to_state: text('to_state').notNull(),
    triggered_by: text('triggered_by').notNull(),
    trigger_event_id: text('trigger_event_id'),
    rationale: text('rationale'),
    attempt_number: integer('attempt_number').notNull(),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index('task_state_history_task_idx').on(t.task_id),
  }),
);
