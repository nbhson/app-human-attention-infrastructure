import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Reverse trace↔correlation mapping (day-03 §2.3).
 *
 * One row per *root* span: given a trace we can find the correlation id, and
 * given a correlation id (a task lifecycle) we can find the trace — a support
 * query can start from either side. Written through on root-span completion
 * only; child spans set `harness.correlation_id` as an attribute but never
 * write here, so this stays a low-volume audit join, not a hot path.
 *
 * `trace_id` and `span_id` are NOT UUIDs — they are the hex strings OTel emits
 * (32 / 16 chars), so they are stored as plain text.
 */
export const traceCorrelation = pgTable(
  'trace_correlation',
  {
    trace_id: text('trace_id').notNull(),
    span_id: text('span_id').notNull(),
    correlation_id: text('correlation_id').notNull(),
    started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primary: primaryKey(table.trace_id, table.span_id),
    correlationIdx: index('trace_correlation_correlation_idx').on(table.correlation_id),
  }),
);
