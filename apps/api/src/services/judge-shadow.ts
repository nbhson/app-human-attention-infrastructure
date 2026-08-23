/**
 * `JudgeShadow` (day-21 §3.4) — the shadow trigger that runs the LLM-as-judge
 * after a review report is created.
 *
 * On `review.report_created` it loads the freshly stored report (findings +
 * suggestions), hands it to the {@link Judge}, and logs the outcome. It never
 * mutates the report, a decision, or routing: the judge is a pure measurement
 * whose score is recorded to `judge_runs` and consumed later (day-22/23). The
 * handler is fire-and-forget — a judge failure is logged, never propagated to
 * the review path it shadows.
 */

import { asc, eq } from 'drizzle-orm';

import {
  brand,
  createFixSuggestion,
  createReviewFinding,
  createReviewReport,
  EventType,
} from '@harness/domain';
import type {
  AiProviderType,
  ReviewReport,
  ReviewReportCreatedPayload,
  ReviewReportID,
  ReviewSeverity,
  ReviewVerdict,
} from '@harness/domain';
import { fixSuggestions, reviewFindings, reviewReports } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';
import type { Judge } from '@harness/judge';

/** Load the stored report as a full domain `ReviewReport`, or `null` if it vanished. */
async function loadReport(db: DrizzleDB, reportId: ReviewReportID): Promise<ReviewReport | null> {
  const reportRows = await db
    .select()
    .from(reviewReports)
    .where(eq(reviewReports.id, reportId))
    .limit(1);
  const row = reportRows[0];
  if (!row) {
    return null;
  }

  const findingRows = await db
    .select()
    .from(reviewFindings)
    .where(eq(reviewFindings.report_id, reportId))
    .orderBy(asc(reviewFindings.order_index));
  const suggestionRows = await db
    .select()
    .from(fixSuggestions)
    .where(eq(fixSuggestions.report_id, reportId))
    .orderBy(asc(fixSuggestions.order_index));

  return createReviewReport({
    id: brand(row.id, 'ReviewReportID'),
    prUrl: row.pr_url,
    prTitle: row.pr_title,
    aiProvider: row.ai_provider as AiProviderType,
    model: row.model,
    summary: row.summary,
    overallVerdict: row.overall_verdict as ReviewVerdict,
    createdAt: row.created_at,
    findings: findingRows.map((finding) =>
      createReviewFinding({
        id: brand(finding.id, 'ReviewFindingID'),
        severity: finding.severity as ReviewSeverity,
        file: finding.file,
        message: finding.message,
        ...(finding.line === null ? {} : { line: finding.line }),
        ...(finding.suggestion === null ? {} : { suggestion: finding.suggestion }),
      }),
    ),
    suggestions: suggestionRows.map((suggestion) =>
      createFixSuggestion({
        id: brand(suggestion.id, 'FixSuggestionID'),
        file: suggestion.file,
        proposed: suggestion.proposed,
        rationale: suggestion.rationale,
        orderIndex: suggestion.order_index,
        ...(suggestion.hunk === null ? {} : { hunk: suggestion.hunk }),
      }),
    ),
  });
}

export class JudgeShadow {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly judge: Judge,
    private readonly logger: Logger,
  ) {}

  subscribe(): void {
    this.bus.subscribe<ReviewReportCreatedPayload>(EventType.ReviewReportCreated, (event) => {
      void this.run(event.payload).catch((error: unknown) => {
        this.logger.warn('judge shadow run failed', {
          review_report_id: event.payload.review_report_id,
          error: String(error),
        });
      });
    });
  }

  /** Load the report and judge it in shadow — log-only, no mutation of review state. */
  async run(payload: ReviewReportCreatedPayload): Promise<void> {
    const report = await loadReport(this.db, payload.review_report_id);
    if (!report) {
      this.logger.warn('judge shadow skipped: report not found', {
        review_report_id: payload.review_report_id,
      });
      return;
    }

    const scores = await this.judge.judgeReport(report, { correlationId: payload.task_id });

    this.logger.info('judge shadow: report scored', {
      review_report_id: payload.review_report_id,
      pr_url: payload.pr_url,
      overall: scores.overall,
    });
  }
}
