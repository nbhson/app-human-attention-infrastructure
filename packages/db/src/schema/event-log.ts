import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { users } from './users.js';

/**
 * Append-only audit log of every bus event. This table is the source of truth
 * for *what happened*; every other table is a current-state projection.
 *
 * No UPDATE, no DELETE — ever (day-04 §2.4).
 */
export const eventLog = pgTable(
  'event_log',
  {
    event_id: text('event_id').primaryKey(),
    event_type: text('event_type').notNull(),
    event_version: integer('event_version').notNull(),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull(),
    correlation_id: text('correlation_id').notNull(),
    // Envelope metadata — who acted (day-02 §2.3). Set from the request-scoped
    // actor when an event is emitted inside an authenticated request; NULL for
    // events published outside any request (loops, subscribers). Not part of the
    // payload, so downstream consumers never have to know about auth.
    actor_id: text('actor_id').references(() => users.id),
    payload: jsonb('payload').notNull(),
  },
  (table) => ({
    correlationIdx: index('event_log_correlation_idx').on(table.correlation_id),
    typeIdx: index('event_log_type_idx').on(table.event_type),
    occurredAtIdx: index('event_log_occurred_at_idx').on(table.occurred_at),
  }),
);
