import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { reviewReports } from './review-reports.js';

/**
 * An actionable fix proposal (review-reorient Phase 3).
 *
 * Kept a *separate* table from {@link reviewFindings} so the web UI can render
 * the two distinct sections the user asked for — "what the AI found" vs "what
 * the AI recommends doing" — without denormalising finding data into suggestions.
 */
export const fixSuggestions = pgTable(
  'fix_suggestions',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reviewReports.id),
    file: text('file').notNull(),
    hunk: text('hunk'),
    proposed: text('proposed').notNull(),
    rationale: text('rationale').notNull(),
    order_index: integer('order_index').notNull().default(0),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('fix_suggestions_report_id_idx').on(table.report_id)],
);
