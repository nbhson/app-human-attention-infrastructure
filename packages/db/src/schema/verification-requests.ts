import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { changes } from './changes.js';
import { tasks } from './tasks.js';

/** What was asked to be checked (verification-engine spec). */
export const verificationRequests = pgTable('verification_requests', {
  id: text('id').primaryKey(),
  task_id: text('task_id')
    .notNull()
    .references(() => tasks.id),
  change_id: text('change_id')
    .notNull()
    .references(() => changes.id),
  requested_checks: jsonb('requested_checks').notNull(),
  timeout_ms: integer('timeout_ms').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
