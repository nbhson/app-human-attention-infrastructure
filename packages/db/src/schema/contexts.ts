import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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

/**
 * A human usefulness mark on one source served inside a context (day-32 §2.2) —
 * the feedback the `UsageLearner` turns into a learned ranking signal. One row per
 * (context, source) verdict; a source may earn several rows across contexts, and
 * the learner aggregates + time-decays them.
 */
export const sourceUsefulness = pgTable('source_usefulness', {
  id: text('id').primaryKey(),
  context_id: text('context_id')
    .notNull()
    .references(() => contexts.id),
  source_id: text('source_id').notNull(),
  useful: boolean('useful').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
