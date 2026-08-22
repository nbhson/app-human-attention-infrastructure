import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { users } from './users.js';

/**
 * Revocable sessions (Phase 2 day-01 §2.2). The JWT is the stateless identity;
 * the `sessions` row is the source of truth for revocation — `revoked_at IS
 * NULL` means active, and logout setting `revoked_at` kills every token minted
 * under the session, valid signature or not.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    issued_at: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    userIdx: index('sessions_user_idx').on(table.user_id),
  }),
);
