import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { assessments } from './assessments.js';
import { changes } from './changes.js';
import { humanDecisionTypeCheck } from './enums.js';
import { users } from './users.js';

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
    // Phase-1 free-form reviewer id; kept for legacy rows, superseded by the
    // day-02 FK below for decisions made under real auth identity.
    reviewer_id: text('reviewer_id').notNull(),
    // Real actor identity (day-02 §2.3). FK to users is NULL until a decision is
    // made by an authenticated principal; backfill leaves unmappable rows NULL.
    actor_id: text('actor_id').references(() => users.id),
    actor_email: text('actor_email'),
    rationale: text('rationale'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [humanDecisionTypeCheck],
);
