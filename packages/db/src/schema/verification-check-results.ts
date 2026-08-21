import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { checkStatusCheck } from './enums.js';
import { evidence } from './evidence.js';
import { verificationReports } from './verification-reports.js';

/**
 * The outcome of one check within a verification report (day-15 §2.4).
 *
 * A leaf row: nothing references it, and its `id` is a plain internal UUIDv7.
 * `output` is the truncated (64 KB cap) stdout/stderr captured by the check —
 * the full output lives in an {@link import('./evidence.js').evidence} row and is
 * linked back through `evidence_id` (Day 17).
 */
export const verificationCheckResults = pgTable(
  'verification_check_results',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => verificationReports.id),
    check_kind: text('check_kind').notNull(),
    status: text('status').notNull(),
    duration_ms: integer('duration_ms').notNull(),
    output: text('output').notNull(),
    evidence_id: text('evidence_id').references(() => evidence.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [checkStatusCheck],
);
