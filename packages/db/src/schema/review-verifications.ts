import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { reviewVerificationStatusCheck } from './enums.js';
import { reviewReports } from './review-reports.js';

/**
 * A machine-side verification run over a review-slice report (review-reorient
 * Phase 3) — the "run the real code" moat wired into the review flow.
 *
 * One row per report (unique on `report_id`), written **best-effort and
 * fire-and-forget**: `status` starts as `RUNNING`, and a background service
 * clones the PR at its head SHA, runs the clone's own `build` then `test` in the
 * Docker sandbox, and records the aggregated {@link VerificationFlag} + markdown
 * render. A verification is never a *gate* — a `FAILED` row is information the
 * reviewer sees alongside the findings, never a write-back blocker.
 *
 * Distinct from {@link import('./verification-reports.js').verificationReports}:
 * that table is keyed by `change_id` (a Phase-1 `change`, NOT NULL) and does not
 * exist for an external-PR review slice that has no change. `flag`/`rendered`
 * hold the flag-shaped summary (verdict + failed/timed-out checks + output tails)
 * so the report surface renders "tests FAILED — see evidence" without re-deriving
 * anything from the raw sandbox run.
 */
export const reviewVerifications = pgTable(
  'review_verifications',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reviewReports.id),
    status: text('status').notNull().default('RUNNING'),
    /** The head SHA actually checked out (provenance for the run). */
    head_sha: text('head_sha'),
    /** SHA-256 of the verified clone bytes (attributability). */
    content_hash: text('content_hash'),
    /** PASSED / FAILED (set once the run completes). */
    overall: text('overall'),
    /** Wall-clock duration in milliseconds. */
    duration_ms: integer('duration_ms'),
    /** The {@link VerificationFlag}: verdict + failed/timed-out kinds + tails. */
    flag: jsonb('flag'),
    /** The markdown rendering of `flag` (produced once at write time). */
    rendered: text('rendered'),
    /** Why the run was skipped / errored (also used for "disabled" / clone fail). */
    error: text('error'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    reviewVerificationStatusCheck,
    uniqueIndex('review_verifications_report_id_unique').on(table.report_id),
  ],
);
