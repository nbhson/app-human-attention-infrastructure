import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Review-slice triage rules (review-reorient Phase 3) — the operator-mutable
 * toggles that shape how a report's findings are triaged before a human decides.
 *
 * A single-row table (`id = 'singleton'`, seeded by the migration) holding three
 * booleans, one per wired rule:
 *
 *  - `security_block` — a CRITICAL finding in an auth/secrets path downgrades the
 *    *effective* recommendation to REQUEST_CHANGES (rule 1, "hạ recommendation").
 *  - `performance_regression` — a MAJOR+ finding in production source code whose
 *    shadow-judge run scored low is surfaced as a regression *risk* (rule 2, an
 *    honest heuristic — not a fabricated "regression detected" claim).
 *  - `schema_integrity` — a PR touching a migration/schema file is flagged so
 *    write-back only proceeds on an explicit, conscious APPROVE (rule 3).
 *
 * All three default `true`, matching the rules page's `enabledByDefault`. The
 * state lives in the DB (not in code/ATTENTION policy) because it is
 * operator-mutable at runtime via `PUT /api/triage-rules`.
 */
export const triageRules = pgTable('triage_rules', {
  id: text('id').primaryKey(),
  security_block: boolean('security_block').notNull().default(true),
  performance_regression: boolean('performance_regression').notNull().default(true),
  schema_integrity: boolean('schema_integrity').notNull().default(true),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
