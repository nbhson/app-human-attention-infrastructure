import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { reviewDecisionTypeCheck } from './enums.js';
import { reviewReports } from './review-reports.js';

/**
 * One human-governed verdict on an AI review report (review-reorient Phase 3
 * day-09).
 *
 * `writeback_enabled` persists the *effective* write-back gate at decision time —
 * the `WRITEBACK_ENABLED` env ceiling AND the request-level flag — even when OFF,
 * so "nothing external was written for this decision" is an auditable fact
 * (day-09 §1 goal 3). The `writeback_log` rows link back through `decision_id`
 * (nullable: a decision with no emitted write has no log rows).
 */
export const reviewDecisions = pgTable(
  'review_decisions',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reviewReports.id),
    decision: text('decision').notNull(),
    rationale: text('rationale'),
    writeback_enabled: boolean('writeback_enabled').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [reviewDecisionTypeCheck, index('review_decisions_report_id_idx').on(table.report_id)],
);
