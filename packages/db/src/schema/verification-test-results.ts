import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { testResultStatusCheck } from './enums.js';
import { verificationCheckResults } from './verification-check-results.js';

/**
 * Per-test leaf results within a TEST check (day-16 §2.3).
 *
 * `TestCheck` parses Vitest's JSON reporter and the engine persists one row per
 * test here, linking back to the owning {@link verificationCheckResults} row via
 * `check_result_id`. `was_retried` flags rows that come from (or followed) a
 * flaky-retry — the Day-18 Attention Engine consumes these to raise risk/novelty.
 */
export const verificationTestResults = pgTable(
  'verification_test_results',
  {
    id: text('id').primaryKey(),
    check_result_id: text('check_result_id')
      .notNull()
      .references(() => verificationCheckResults.id),
    test_file: text('test_file').notNull(),
    test_name: text('test_name').notNull(),
    status: text('status').notNull(),
    duration_ms: integer('duration_ms').notNull(),
    error: text('error'),
    was_retried: boolean('was_retried').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [testResultStatusCheck],
);
