/**
 * `POST /api/reviews/:id/retry` — reset a failed report to pending, clear the
 * stale findings/suggestions/judge/verification/LLM artefacts in ONE
 * transaction, and re-publish `review.requested` so the background worker
 * re-runs the review (retry re-verifies).
 */

import type { FastifyInstance } from 'fastify';

import { eq } from 'drizzle-orm';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { brand, EventType, Role } from '@harness/domain';
import type { ReviewReportID, ReviewRequestedPayload } from '@harness/domain';
import { fixSuggestions, judgeRuns, llmCallLog, reviewFindings, reviewReports, reviewVerifications } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';

import { checkSensitiveRateLimit } from '../rate-limit.js';
import { loadTriageRuleState } from '../triage-rules-store.js';

/** Register `POST /api/reviews/:id/retry` (transactional reset + re-publish). */
export function registerReviewRetryRoute(app: FastifyInstance, container: Container): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const bus = container.resolve<IEventBus>(TOKENS.EventBus);

  app.post<{ Params: { id: string } }>(
    '/api/reviews/:id/retry',
    { preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) },
    async (request, reply) => {
      if (!checkSensitiveRateLimit(request.ip)) {
        return reply.code(429).send({ error: 'rate limit exceeded — slow down and try again' });
      }
      const id = request.params.id as ReviewReportID;
      const reportRows = await db.select().from(reviewReports).where(eq(reviewReports.id, id)).limit(1);
      const report = reportRows[0];
      if (!report) {
        return reply.code(404).send({ error: 'review report not found' });
      }
      if (report.review_status !== 'error') {
        return reply.code(400).send({ error: 'only failed reports can be retried' });
      }

      // 1. Clear stale findings + suggestions + judge/verification artefacts (P0 fix:
      // retry must re-verify — ReviewVerificationService early-returns when a row
      // exists, so a stale RUNNING/ERROR row would block re-verification forever).
      // P0 fix #2: all clears + the status reset run in ONE transaction — a crash
      // mid-sequence previously left the report half-cleared (e.g. findings gone
      // but review_status still `error`, or artefacts gone but not re-queueable).
      await db.transaction(async (tx) => {
        await tx.delete(reviewFindings).where(eq(reviewFindings.report_id, id));
        await tx.delete(fixSuggestions).where(eq(fixSuggestions.report_id, id));
        await tx.delete(judgeRuns).where(eq(judgeRuns.report_id, id));
        await tx.delete(reviewVerifications).where(eq(reviewVerifications.report_id, id));
        if (report.correlation_id !== null && report.correlation_id !== undefined) {
          await tx.delete(llmCallLog).where(eq(llmCallLog.correlation_id, report.correlation_id));
        }

        // 2. Reset report status to pending.
        await tx
          .update(reviewReports)
          .set({
            review_status: 'pending',
            summary: '',
            overall_verdict: 'COMMENT',
            batch_progress: null,
            completed_at: null,
          })
          .where(eq(reviewReports.id, id));
      });

      // 3. Re-publish the review.requested event so the worker picks it up.
      const ruleState = await loadTriageRuleState(db);
      const payload: ReviewRequestedPayload = {
        task_id: report.task_id !== null ? brand(report.task_id, 'TaskID') : brand(id, 'TaskID'),
        review_report_id: id,
        pr_url: report.pr_url,
        ...(ruleState.autoReviewEnabled ? { autoReviewMode: true } : {}),
      };
      bus.publish(createEvent(EventType.ReviewRequested, brand(id, 'CorrelationID'), payload));

      return reply.code(202).send({ reportId: id, status: 'pending' });
    },
  );
}
