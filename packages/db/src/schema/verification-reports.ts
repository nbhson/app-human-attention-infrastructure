import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { changes } from './changes.js';
import { reportOverallCheck } from './enums.js';
import { tasks } from './tasks.js';

/**
 * A single verification run over one change (day-15 §2.4).
 *
 * This is the Day-15 persistence of a `VerificationResult`: the aggregated
 * `overall` verdict plus wall-clock `duration_ms`. The per-check breakdown lives
 * in {@link import('./verification-check-results.js').verificationCheckResults}.
 * `id` reuses `VerificationResultID` from `@harness/domain` so it flows straight
 * into the `verification.completed` event's `result_id`.
 */
export const verificationReports = pgTable(
  'verification_reports',
  {
    id: text('id').primaryKey(),
    change_id: text('change_id')
      .notNull()
      .references(() => changes.id),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id),
    overall: text('overall').notNull(),
    duration_ms: integer('duration_ms').notNull(),
    flaky: boolean('flaky').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [reportOverallCheck],
);
