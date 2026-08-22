import { integer, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Shadow rank-comparison records (day-18 §2.4).
 *
 * One row per "resolve context for a task", written *only* when the semantic
 * shadow is enabled (a per-request opt-in flag, default OFF). It captures both
 * ranked orderings — the served keyword order and the shadow semantic order — so
 * Day 29's A/B harness has a pre-aggregated signal for whether semantic ranking
 * actually differs from keyword, before any live switch is considered.
 *
 * This table is write-only shadow telemetry: nothing on the default
 * `resolveContext` path reads or writes it (§2.3 — the served `rank_method` is
 * always keyword). The `rank_correlation` (Kendall tau over the overlapping
 * top-k) is computed at write time so disagreement is visible before a head-to-head.
 */
export const shadowRankComparisons = pgTable('shadow_rank_comparisons', {
  id: text('id').primaryKey(),
  task_id: text('task_id').notNull(),
  /** The `contexts` snapshot this comparison was derived from. */
  context_id: text('context_id').notNull(),
  /** Serviced keyword ordering (sourceIds in descending relevance). */
  keyword_order: jsonb('keyword_order').$type<string[]>().notNull(),
  /** Shadow semantic ordering (sourceIds in descending cosine similarity). */
  semantic_order: jsonb('semantic_order').$type<string[]>().notNull(),
  /** Kendall tau between the two orderings over their overlap; NULL if <2 shared. */
  rank_correlation: numeric('rank_correlation'),
  /** The k used for the top-k correlation (the injected context size). */
  top_k: integer('top_k').notNull().default(10),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
