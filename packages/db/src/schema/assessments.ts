import { jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';

import { artifacts } from './artifacts.js';
import { changes } from './changes.js';
import { priorityLabelCheck } from './enums.js';

/** Priority scores + labels from the attention engine. */
export const assessments = pgTable(
  'assessments',
  {
    id: text('id').primaryKey(),
    artifact_id: text('artifact_id')
      .notNull()
      .references(() => artifacts.id),
    change_id: text('change_id')
      .notNull()
      .references(() => changes.id),
    risk_score: real('risk_score').notNull(),
    impact_score: real('impact_score').notNull(),
    novelty_score: real('novelty_score').notNull(),
    complexity_score: real('complexity_score').notNull(),
    confidence_score: real('confidence_score').notNull(),
    combined_priority: real('combined_priority').notNull(),
    label: text('label').notNull(),
    // List of factor names that were defaulted to 0.5 (missing evidence).
    factors_unavailable: jsonb('factors_unavailable').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [priorityLabelCheck],
);
