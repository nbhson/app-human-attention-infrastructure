import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Registered users (Phase 2 day-01 §2.1). Identity is keyed on the
 * provider-stable `oidc_sub`; `id` is the internal UUIDv7 every other table
 * foreign-keys to, so re-provisioning never rewrites history.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    oidc_sub: text('oidc_sub').notNull().unique(),
    email: text('email').notNull(),
    display_name: text('display_name').notNull(),
    // Phase-1 role on first sight; Day 02 adds enforcement (additive: ADMIN ⊇
    // REVIEWER ⊇ OPERATOR).
    roles: jsonb('roles').notNull().$type<string[]>().default(['OPERATOR']),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    oidcSubIdx: index('users_oidc_sub_idx').on(table.oidc_sub),
  }),
);
