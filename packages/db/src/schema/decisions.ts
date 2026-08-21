import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { assessments } from './assessments.js';
import { changes } from './changes.js';
import { humanDecisionTypeCheck } from './enums.js';

/** Human review decisions (review spec). */
export const decisions = pgTable(
  'decisions',
  {
    id: text('id').primaryKey(),
    // Task lifecycle id (== tasks.id in Phase 1) copied from the task under
    // review so the decision joins to event_log (day-27 §2.2).
    correlation_id: text('correlation_id'),
    change_id: text('change_id')
      .notNull()
      .references(() => changes.id),
    assessment_id: text('assessment_id')
      .notNull()
      .references(() => assessments.id),
    decision: text('decision').notNull(),
    reviewer_id: text('reviewer_id').notNull(),
    rationale: text('rationale'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [humanDecisionTypeCheck],
);
