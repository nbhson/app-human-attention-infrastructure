import { boolean, doublePrecision, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The review-quality benchmark corpus (review-reorient Phase 3 day-24 §2.1) —
 * gold-labeled *review examples*, not coding tasks.
 *
 * Each row is the raw materials a reviewer sees (a redacted PR diff + a
 * requirement) plus the AI's review report (a judged artifact) and the human's
 * **gold** labels: how the human rated the report's severity attribution and
 * routing, and whether the review was useful. Gold labels are human-derived —
 * never judge output — and versioned (`scale_version` + `label_set`) so changing
 * the rubric scale bumps the version and retags labels instead of mutating them
 * in place (day-24 §2.2).
 *
 * Append-only, read-mostly: `@harness/benchmark` reads this corpus (filtered by
 * `scale_version`) to benchmark the judge and the Day-39 regression. It carries
 * no SUT patch, no code-generation task, and no SWE-bench rerun.
 */
export const reviewExamples = pgTable(
  'review_examples',
  {
    id: text('id').primaryKey(),
    /** Rubric scale version this example's gold labels are valid under. */
    scale_version: text('scale_version').notNull(),
    /** The human label taxonomy (`severity`/`routing`/`useful`). */
    label_set: text('label_set').notNull(),
    /** Provenance of the example (e.g. `phase2-review-redacted-001`). */
    source: text('source').notNull(),
    /** The redacted PR diff (identifiers stripped — no secrets, no org code). */
    pr_diff: text('pr_diff').notNull(),
    /** The review requirement / ticket text (redacted). */
    requirement: text('requirement').notNull(),
    /** The AI report's judged artifact: `{ verdict, summary, findings[] }`. */
    report: jsonb('report').notNull(),
    /** Human gold: severity attribution correctness, in `[0,1]`. */
    gold_severity: doublePrecision('gold_severity').notNull(),
    /** Human gold: routing correctness, in `[0,1]`. */
    gold_routing: doublePrecision('gold_routing').notNull(),
    /** Human gold: was the review useful? */
    gold_useful: boolean('gold_useful').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('review_examples_scale_version_idx').on(table.scale_version)],
);
