import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';

/** Assembled context packages delivered to agents (context-engine spec). */
export const contexts = pgTable('contexts', {
  id: text('id').primaryKey(),
  task_id: text('task_id')
    .notNull()
    .references(() => tasks.id),
  sources: jsonb('sources').notNull(),
  total_tokens: integer('total_tokens').notNull().default(0),
  rank_method: text('rank_method').notNull(),
  summary: text('summary'),
  metadata: jsonb('metadata').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
