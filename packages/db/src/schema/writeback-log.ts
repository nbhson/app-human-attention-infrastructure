import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { writebackActionCheck, writebackStatusCheck } from './enums.js';

/**
 * One attempt to write an outcome back to the PR or the ticket
 * (review-reorient Phase 3 day-08).
 *
 * Append-only: a retry appends a new row rather than mutating the old one, so the
 * full write-back history is replayable. Written behind a per-provider toggle;
 * when toggled off, no row exists and nothing external happens.
 *
 * Idempotency (day-08 §2.2): `dedup_key` is the deterministic fingerprint of an
 * intent (provider | external target | action | normalized payload); the partial
 * unique index below allows at most one `SUCCEEDED` row per key, so a retried or
 * racing identical write is caught by the store and marked `DUPLICATE` instead of
 * double-posting.
 */
export const writebackLog = pgTable(
  'writeback_log',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    external_id: text('external_id').notNull(),
    action: text('action').notNull(),
    body: text('body').notNull(),
    dedup_key: text('dedup_key').notNull(),
    status: text('status').notNull().default('PENDING'),
    external_ref: text('external_ref'),
    error: text('error'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    writebackActionCheck,
    writebackStatusCheck,
    uniqueIndex('writeback_log_dedup_succeeded_uniq')
      .on(table.dedup_key)
      .where(sql`${table.status} = 'SUCCEEDED'`),
    index('writeback_log_provider_external_idx').on(table.provider, table.external_id),
  ],
);
