import { doublePrecision, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { reviewReports } from './review-reports.js';

/**
 * One audited judge run (review-reorient Phase 3 day-21, provenance day-22 §2.2).
 *
 * The LLM-as-judge scores a review report against a versioned rubric; every run
 * is logged here (report id + content hash, prompt version, model, temperature,
 * numeric scores, raw reasoning) so a score is never trusted unlogged — and any
 * downstream agreement figure (day-22) can be recomputed from these rows. Scores
 * are `double precision` in `[0,1]`, mirroring the domain
 * [`JudgeScores`](`@harness/domain`) contract — no scale conversion between the
 * judge and its persisted row. Append-only: the run id is a fresh UUID, never a
 * report key, and rows are never updated in place. Shadow-only: nothing reads
 * these rows yet (day-23 wires weight fitting).
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
    temperature: doublePrecision('temperature'),
    report_hash: text('report_hash').notNull(),
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

/**
 * One inter-judge agreement computation (day-22 §2.4) — append-only.
 *
 * Aggregates N matched run pairs into per-dimension agreement + Cohen's κ, and
 * stores the very run ids (and report hashes) it was computed from so the number
 * can be recomputed from `judge_runs` — a screenshot is not an audit. Rows are
 * never updated.
 */
export const judgeAgreements = pgTable(
  'judge_agreements',
  {
    id: text('id').primaryKey(),
    run_a_ids: text('run_a_ids').array().notNull(),
    run_b_ids: text('run_b_ids').array().notNull(),
    report_hashes: text('report_hashes').array().notNull(),
    n: integer('n').notNull(),
    severity_agreement: doublePrecision('severity_agreement').notNull(),
    severity_kappa: doublePrecision('severity_kappa').notNull(),
    routing_agreement: doublePrecision('routing_agreement').notNull(),
    routing_kappa: doublePrecision('routing_kappa').notNull(),
    evidence_agreement: doublePrecision('evidence_agreement').notNull(),
    evidence_kappa: doublePrecision('evidence_kappa').notNull(),
    overall_agreement: doublePrecision('overall_agreement').notNull(),
    overall_kappa: doublePrecision('overall_kappa').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('judge_agreements_created_at_idx').on(table.created_at)],
);
