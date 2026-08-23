import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { aiProviderCheck, reviewSeverityCheck, reviewVerdictCheck } from './enums.js';
import { tasks } from './tasks.js';

/**
 * The AI's review of an external pull request (review-reorient Phase 3).
 *
 * One row per generated report. `pr_payload` holds the full {@link PullRequest}
 * snapshot (metadata + per-file diff) the AI read, so the report stays
 * self-contained and audit-replayable even if the PR later changes or the host
 * URL expires. `task_id` is nullable — the review slice may run without driving
 * the orchestrator's canonical task machine — but when a task exists it joins to
 * the rest of the provenance trail.
 */
export const reviewReports = pgTable(
  'review_reports',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id').references(() => tasks.id),
    correlation_id: text('correlation_id'),
    pr_url: text('pr_url').notNull(),
    pr_number: integer('pr_number').notNull(),
    repo: text('repo').notNull(),
    pr_title: text('pr_title').notNull(),
    ai_provider: text('ai_provider').notNull(),
    model: text('model').notNull(),
    summary: text('summary').notNull(),
    overall_verdict: text('overall_verdict').notNull(),
    pr_payload: jsonb('pr_payload').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    aiProviderCheck,
    reviewVerdictCheck,
    index('review_reports_pr_url_idx').on(table.pr_url),
    index('review_reports_task_id_idx').on(table.task_id),
  ],
);

/**
 * One problem the AI found in the PR (review-reorient Phase 3). A child of
 * {@link reviewReports}; `order_index` preserves the report's severity-then-file
 * ordering.
 */
export const reviewFindings = pgTable(
  'review_findings',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reviewReports.id),
    severity: text('severity').notNull(),
    file: text('file').notNull(),
    line: integer('line'),
    message: text('message').notNull(),
    suggestion: text('suggestion'),
    order_index: integer('order_index').notNull().default(0),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [reviewSeverityCheck, index('review_findings_report_id_idx').on(table.report_id)],
);
