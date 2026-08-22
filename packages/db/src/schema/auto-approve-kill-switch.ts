import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { users } from './users.js';

/**
 * Auto-approve flag + kill-switch (day-14 §2.2).
 *
 * A single-row table holding the two runtime controls the auto-approve path reads
 * on every decision:
 *
 *  - `auto_approve_enabled` — the feature flag, **off by default and gated on
 *    calibration green**; an ADMIN flips it via `POST /api/admin/auto-approve/enabled`.
 *  - `enabled` — the kill-switch (false = KILLED). One UPDATE on the singleton
 *    row (`id = 'singleton'`) disables auto-approve *and* lets the executor requeue
 *    every in-flight `AUTO_APPROVABLE` item back into the human queue.
 *
 * There is exactly one row (`id = 'singleton'`), seeded by the migration. The flag
 * lives in the DB rather than in `ATTENTION_POLICY_V1` because it is operator-mutable
 * at runtime, while the policy's static tuning (`autoApprove.maxRisk`,
 * `autoApprove.auditSampleRate`) stays in code.
 */
export const autoApproveKillSwitch = pgTable('auto_approve_kill_switch', {
  id: text('id').primaryKey(),
  // Feature flag — default false so a fresh DB never auto-approves (day-14 §5).
  auto_approve_enabled: boolean('auto_approve_enabled').notNull().default(false),
  // Kill-switch — default true = live; false = KILLED.
  enabled: boolean('enabled').notNull().default(true),
  killed_at: timestamp('killed_at', { withTimezone: true }),
  killed_by: text('killed_by').references(() => users.id),
  reason: text('reason'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
