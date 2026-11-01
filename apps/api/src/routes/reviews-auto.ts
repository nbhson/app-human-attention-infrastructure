/**
 * `POST /api/reviews/auto` — synchronous full code-review endpoint. Returns ALL
 * severities (including MINOR/NIT/INFO) when `auto_review_enabled` is ON in the
 * triage rules. Separate from `POST /api/reviews` because it bypasses the async
 * event-driven flow and returns results synchronously for the UI's auto-review
 * mode.
 */

import type { FastifyInstance } from 'fastify';

import { asc, eq } from 'drizzle-orm';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { Role } from '@harness/domain';
import { fixSuggestions, reviewFindings, reviewReports } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import { GitProviderError } from '@harness/git-provider';

import { ReviewIngestError, ReviewIngestService } from '../services/review-ingest.js';
import { loadTriageRuleState } from '../triage-rules-store.js';
import { CreateReviewBodySchema, formatZodError } from '../validation.js';

/** Register `POST /api/reviews/auto` (sync full-severity review). */
export function registerReviewAutoRoute(
  app: FastifyInstance,
  container: Container,
  rateLimit?: (ip: string) => boolean,
): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);

  app.post<{ Body: unknown }>(
    '/api/reviews/auto',
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
        // Check if auto-review mode is enabled in triage rules.
        const ruleState = await loadTriageRuleState(db);
        if (!ruleState.autoReviewEnabled) {
          return reply
            .code(400)
            .send({ error: 'auto-review mode is disabled — enable it in the triage rules settings' });
        }

        // Use the existing ingest service to run the review with auto mode enabled.
        const ingest = container.resolve<ReviewIngestService>(TOKENS.ReviewIngestService);
        const result = await ingest.ingest({
          prUrl: prUrl.trim(),
          autoReviewMode: true,
          ...(typeof jiraTicket === 'string' && jiraTicket.trim().length > 0 ? { jiraTicket: jiraTicket.trim() } : {}),
        });

        // Fetch the report with all findings for the response.
        const reportRows = await db.select().from(reviewReports).where(eq(reviewReports.id, result.reportId)).limit(1);
        const report = reportRows[0];
        if (!report) {
          return reply.code(404).send({ error: 'review report not found' });
        }

        const [findingsRows, suggestionsRows] = await Promise.all([
          db
            .select()
            .from(reviewFindings)
            .where(eq(reviewFindings.report_id, result.reportId))
            .orderBy(asc(reviewFindings.order_index)),
          db
            .select()
            .from(fixSuggestions)
            .where(eq(fixSuggestions.report_id, result.reportId))
            .orderBy(asc(fixSuggestions.order_index)),
        ]);

        return {
          reportId: result.reportId,
          prUrl: result.prUrl,
          summary: report.summary,
          overallVerdict: report.overall_verdict,
          findings: findingsRows.map((f) => ({
            id: f.id,
            severity: f.severity,
            kind: f.kind,
            file: f.file,
            line: f.line,
            message: f.message,
            suggestion: f.suggestion,
          })),
          suggestions: suggestionsRows.map((s) => ({
            id: s.id,
            file: s.file,
            hunk: s.hunk,
            proposed: s.proposed,
            rationale: s.rationale,
          })),
        };
      } catch (error) {
        if (error instanceof ReviewIngestError) {
          return reply.code(error.status).send({ error: error.message });
        }
        if (error instanceof GitProviderError) {
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
