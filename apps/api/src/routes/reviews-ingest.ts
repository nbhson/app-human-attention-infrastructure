/**
 * `POST /api/reviews` — the review-slice ingest endpoint (review-reorient
 * Phase 3). Thin Fastify surface over {@link ReviewIngestService}: validates the
 * body, creates the report + Task anchor via the service, and publishes
 * `review.requested` so the async worker runs the actual AI review. Returns
 * `202 Accepted` with the placeholder report coordinates.
 */

import type { FastifyInstance } from 'fastify';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { brand, EventType, Role } from '@harness/domain';
import type { ReviewRequestedPayload } from '@harness/domain';
import type { DrizzleDB } from '@harness/db';

import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { GitProviderError } from '@harness/git-provider';

import { ReviewIngestError, ReviewIngestService } from '../services/review-ingest.js';
import { loadTriageRuleState } from '../triage-rules-store.js';
import { CreateReviewBodySchema, formatZodError } from '../validation.js';

/** Register `POST /api/reviews` (async ingest → 202). */
export function registerReviewIngestRoute(
  app: FastifyInstance,
  container: Container,
  rateLimit?: (ip: string) => boolean,
): void {
  const ingest = container.resolve<ReviewIngestService>(TOKENS.ReviewIngestService);
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const bus = container.resolve<IEventBus>(TOKENS.EventBus);

  app.post<{ Body: unknown }>(
    '/api/reviews',
    { preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) },
    async (request, reply) => {
      // Rate-limit the AI-backed ingest so a misconfigured client can't exhaust
      // the provider quota. Only checked when a limiter is wired in (app.ts).
      if (rateLimit !== undefined) {
        const ip = request.ip;
        if (!rateLimit(ip)) {
          return reply.code(429).send({ error: 'rate limit exceeded — slow down and try again' });
        }
      }
      const parsed = CreateReviewBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: formatZodError(parsed.error) });
      }
      const { prUrl, jiraTicket } = parsed.data;
      try {
        // Fast path: create report with placeholder, publish event, return 202.
        // The actual AI review runs asynchronously via the `review.requested` subscriber.
        const ruleState = await loadTriageRuleState(db);
        const result = await ingest.createReview({
          prUrl: prUrl.trim(),
          ...(typeof jiraTicket === 'string' && jiraTicket.trim().length > 0 ? { jiraTicket: jiraTicket.trim() } : {}),
          ...(ruleState.autoReviewEnabled ? { autoReviewMode: true } : {}),
        });
        // Publish event so the background worker picks it up.
        const payload: ReviewRequestedPayload = {
          task_id: result.taskId,
          review_report_id: result.reportId,
          pr_url: result.prUrl,
          ...(typeof jiraTicket === 'string' && jiraTicket.trim().length > 0 ? { jira_ticket: jiraTicket.trim() } : {}),
          ...(ruleState.autoReviewEnabled ? { autoReviewMode: true } : {}),
        };
        bus.publish(createEvent(EventType.ReviewRequested, brand(result.reportId, 'CorrelationID'), payload));
        return reply.code(202).send({
          reportId: result.reportId,
          taskId: result.taskId,
          prUrl: result.prUrl,
          status: 'pending',
        });
      } catch (error) {
        if (error instanceof ReviewIngestError) {
          return reply.code(error.status).send({ error: error.message });
        }
        if (error instanceof GitProviderError) {
          // A git-host read failed (not-found / auth / rate-limit / network):
          // surface the useful status instead of a bare 500 so the create screen
          // can tell "inaccessible pull request" from an internal failure.
          if (error.status === 404) {
            return reply.code(404).send({ error: 'That pull request could not be found or is not accessible.' });
          }
          if (error.status === 401 || error.status === 403) {
            return reply.code(422).send({
              error: 'That repository is not accessible — check the GITHUB_TOKEN permissions.',
            });
          }
          return reply.code(502).send({ error: 'The Git host could not be reached. Try again in a moment.' });
        }
        throw error;
      }
    },
  );
}
