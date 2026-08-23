import { doublePrecision, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { reviewReports } from './review-reports.js';

/**
 * One audited judge run (review-reorient Phase 3 day-21 §2.3).
 *
 * The LLM-as-judge scores a review report against a versioned rubric; every run
 * is logged here (report id, prompt version, model, numeric scores, raw
 * reasoning) so a score is never trusted unlogged. Scores are `double precision`
 * in `[0,1]`, mirroring the domain [`JudgeScores`](`@harness/domain`) contract —
 * no scale conversion between the judge and its persisted row. Shadow-only
 * today: nothing reads these rows yet (day-22 wires the consumer).
 */
export const judgeRuns = pgTable(
  'judge_runs',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reviewReports.id),
    prompt_version: text('prompt_version').notNull(),
    model: text('model').notNull(),
    severity_agreement: doublePrecision('severity_agreement').notNull(),
    routing_agreement: doublePrecision('routing_agreement').notNull(),
    evidence_sufficiency: doublePrecision('evidence_sufficiency').notNull(),
    overall: doublePrecision('overall').notNull(),
    reasoning: text('reasoning').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('judge_runs_report_id_idx').on(table.report_id),
    index('judge_runs_created_at_idx').on(table.created_at),
  ],
);
