import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { writebackActionCheck, writebackStatusCheck, writebackTargetCheck } from './enums.js';
import { reviewReports } from './review-reports.js';

/**
 * One attempt to write an outcome back to the PR or the ticket
 * (review-reorient Phase 3).
 *
 * Append-only: a retry appends a new row rather than mutating the old one, so the
 * full write-back history is replayable. Written behind a per-provider toggle;
 * when toggled off, no row exists and nothing external happens.
 */
export const writebackLog = pgTable(
  'writeback_log',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reviewReports.id),
    target: text('target').notNull(),
    action: text('action').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('PENDING'),
    error: text('error'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    writebackTargetCheck,
    writebackActionCheck,
    writebackStatusCheck,
    index('writeback_log_report_id_idx').on(table.report_id),
  ],
);
