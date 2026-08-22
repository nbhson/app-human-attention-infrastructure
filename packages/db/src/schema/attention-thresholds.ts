import { AnyPgColumn, doublePrecision, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { thresholdBandCheck } from './enums.js';

/**
 * Adaptive review thresholds (day-13 §2.2).
 *
 * The HIGH/CRITICAL band cutoffs the Attention Router applies to a
 * `combined_priority` are **mutable, versioned, append-only history**. Every
 * `AdaptiveThresholdController` step INSERTs a new row that `supersedes` the
 * previous value for the same `(project_id, band)` — there is no UPDATE, so the
 * "who moved what, when, and why" audit is a straight `SELECT ... ORDER BY applied_at`
 * over this table. "Revert" is itself a new row whose `cutoff` copies the value
 * two steps back, keeping the chain intact (day-13 §6).
 *
 * `cutoff` is clamped to `[min_bounds, max_bounds]` by the controller before it is
 * written; both bounds are persisted per-row so a later reader can prove the clamp
 * was honoured even if the controller's constants change.
 */
export const attentionThresholds = pgTable(
  'attention_thresholds',
  {
    id: text('id').primaryKey(),
    // v0 is single-tenant; kept as a column so multi-project isolation is a
    // backfill rather than a schema change.
    project_id: text('project_id').notNull(),
    // 'HIGH' | 'CRITICAL' — MEDIUM/LOW are fixed in v0.
    band: text('band').notNull(),
    cutoff: doublePrecision('cutoff').notNull(),
    min_bounds: doublePrecision('min_bounds').notNull(),
    max_bounds: doublePrecision('max_bounds').notNull(),
    applied_at: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    // The observed condition that drove the move, e.g. `approval_rate 0.97 > 0.95`.
    reason: text('reason').notNull(),
    // The row this value replaces (NULL for the initial seed). Self-referential,
    // append-only: a revert points at the row it restores, never overwrites it.
    supersedes: text('supersedes').references((): AnyPgColumn => attentionThresholds.id),
  },
  () => [thresholdBandCheck],
);
