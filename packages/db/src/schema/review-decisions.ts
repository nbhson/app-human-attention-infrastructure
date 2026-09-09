import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
 *
 * `dedup_key` is the idempotency fingerprint
 * (`sha256(report_id | decision | rationale | comment | writeback_enabled)`):
 * double-clicks / client retries with the same payload resolve to the same key,
 * so the decision endpoint returns the existing row instead of a duplicate (P0).
 * NOT NULL by design: Postgres unique indexes allow multiple NULLs, so a
 * nullable key would silently bypass dedup. Every insert must supply it.
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
    dedup_key: text('dedup_key').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    reviewDecisionTypeCheck,
    index('review_decisions_report_id_idx').on(table.report_id),
    uniqueIndex('review_decisions_dedup_key_uniq').on(table.dedup_key),
  ],
);
