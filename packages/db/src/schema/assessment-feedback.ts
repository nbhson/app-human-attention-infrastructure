import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { assessments } from './assessments.js';

/**
 * A reviewer's usefulness verdict on an assessment (attention spec §4.1).
 *
 * "Did this item deserve your attention at this priority?" is the feedback loop
 * that lets the adaptive-threshold controller detect that the engine is crying
 * wolf (algorithmic alert fatigue). Append-only: one row per feedback submission.
 */
export const assessmentFeedback = pgTable('assessment_feedback', {
  id: text('id').primaryKey(),
  assessment_id: text('assessment_id')
    .notNull()
    .references(() => assessments.id),
  was_useful: boolean('was_useful').notNull(),
  comment: text('comment'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
