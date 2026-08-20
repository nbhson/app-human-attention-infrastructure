import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { verificationStatusCheck } from './enums.js';
import { verificationRequests } from './verification-requests.js';

/** What was actually found (verification-engine spec). */
export const verificationResults = pgTable(
  'verification_results',
  {
    id: text('id').primaryKey(),
    request_id: text('request_id')
      .notNull()
      .references(() => verificationRequests.id),
    status: text('status').notNull(),
    check_results: jsonb('check_results').notNull(),
    execution_env: text('execution_env'),
    duration_ms: integer('duration_ms').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [verificationStatusCheck],
);
