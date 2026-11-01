/**
 * `POST /api/reviews/:id/decision` — the human's approve/reject/request-changes
 * call (day-09). Persists a `review_decisions` row (with the effective
 * write-back toggle for audit) and, when the toggle is ON and the verdict is
 * APPROVE/REJECT, posts a COMMENT + STATUS back to the PR through the
 * `WriteBackService` seam.
 *
 * Idempotency (P0 fix): a deterministic `dedup_key` (sha256 over
 * report + decision + rationale + comment + toggle) makes double-clicks /
 * retries with the same payload return the existing decision instead of
 * inserting a duplicate; the write-back intents reuse deterministic ids so a
 * saga retry resumes only the missing half (207 on partial failure).
 */

import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { brand, EventType, newDecisionID, ReviewDecisionType, Role, WritebackAction } from '@harness/domain';
import type { ReviewReportID, WriteBackIntent } from '@harness/domain';
import { reviewDecisions, reviewFindings, reviewReports, fixSuggestions, writebackLog } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { parseRepoPath, StaticGitToolMap } from '@harness/git-provider';
import { WriteBackError } from '@harness/writeback';
import type { WriteBackService } from '@harness/writeback';

import { formatRejectWritebackBody } from '../format-review-writeback.js';
import { checkSensitiveRateLimit } from '../rate-limit.js';
import { DecisionInsertError } from '../services/review-ingest.js';
import { ReviewDecideBodySchema, formatZodError } from '../validation.js';
import { writebackEnabled } from '../writeback-gate.js';

/**
 * The per-host tool map, resolved per request (not module-level) so Bitbucket
 * Server / Data Center domains from `BITBUCKET_DOMAINS` / `BITBUCKET_URL` are
 * honoured — `.env` is loaded after this module is first imported.
 */
function getGitToolMap(): StaticGitToolMap {
  return StaticGitToolMap.fromEnv();
}

/** Deterministic idempotency fingerprint for a human decision (P0 fix). */
export function decisionDedupKey(input: {
  readonly reportId: string;
  readonly decision: string;
  readonly rationale?: string;
  readonly comment?: string;
  readonly writebackEnabled: boolean;
}): string {
  const h = createHash('sha256');
  h.update(
    [input.reportId, input.decision, input.rationale ?? '', input.comment ?? '', String(input.writebackEnabled)].join(
      '|',
    ),
  );
  return h.digest('hex');
}

/**
 * Deterministic write-back intent id so retries reuse the same dedup_key.
 * Full sha256 hex (64 chars) — no truncation, so no birthday-shortening of
 * the collision space; `WriteBackIntent.id` is an unbounded string.
 */
function deterministicWritebackId(decisionId: string, action: string): string {
  return createHash('sha256').update(`${decisionId}|${action}`).digest('hex');
}

/** Register `POST /api/reviews/:id/decision` (idempotent human decision + write-back). */
export function registerReviewDecisionRoute(app: FastifyInstance, container: Container): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const bus = container.resolve<IEventBus>(TOKENS.EventBus);

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/reviews/:id/decision',
    { preHandler: requireRole(container, Role.Reviewer, Role.Admin) },
    async (request, reply) => {
      if (!checkSensitiveRateLimit(request.ip)) {
        return reply.code(429).send({ error: 'rate limit exceeded — slow down and try again' });
      }
      const id = request.params.id as ReviewReportID;
      const parsed = ReviewDecideBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: formatZodError(parsed.error) });
      }
      const { decision, rationale, writeback: requestWriteback, comment } = parsed.data;

      const reportRows = await db.select().from(reviewReports).where(eq(reviewReports.id, id)).limit(1);
      const report = reportRows[0];
      if (!report) {
        return reply.code(404).send({ error: 'review report not found' });
      }

      // The effective write-back gate: request-level flag AND env ceiling. An
      // unset env, a missing flag, or either steam OFF all fail safe (day-09 §2.1).
      const effective = writebackEnabled(requestWriteback);
      const userCommentRaw = comment;
      const userCommentForKey = userCommentRaw && userCommentRaw.length > 0 ? userCommentRaw : undefined;

      // P0 fix: idempotency fingerprint — double-clicks / retries with the same
      // payload return the existing decision instead of inserting a duplicate.
      const dedupKey = decisionDedupKey({
        reportId: id,
        decision,
        ...(rationale === undefined ? {} : { rationale }),
        ...(userCommentForKey === undefined ? {} : { comment: userCommentForKey }),
        writebackEnabled: effective,
      });
      const existing = await db.select().from(reviewDecisions).where(eq(reviewDecisions.dedup_key, dedupKey)).limit(1);
      if (existing[0]) {
        const priorWrites = await db
          .select()
          .from(writebackLog)
          .where(eq(writebackLog.decision_id, existing[0].id))
          .limit(2);
        return { reportId: id, decision, decisionId: existing[0].id, deduped: true, writebacks: priorWrites.length };
      }

      // Persist the decision with its toggle state so "nothing was written" is an
      // auditable fact, not an absence (day-09 §1 goal 3).
      const decisionId = newDecisionID();
      try {
        await db.insert(reviewDecisions).values({
          id: decisionId,
          report_id: id,
          decision,
          ...(rationale === undefined ? {} : { rationale }),
          writeback_enabled: effective,
          dedup_key: dedupKey,
        });
      } catch {
        // Unique race: another request won — return the winner (idempotent).
        const winner = await db.select().from(reviewDecisions).where(eq(reviewDecisions.dedup_key, dedupKey)).limit(1);
        if (winner[0]) {
          return { reportId: id, decision, decisionId: winner[0].id, deduped: true };
        }
        throw new DecisionInsertError();
      }

      // The memory write-half (wedge #2) is event-driven: publish the review-slice
      // decision so `MemoryIngestor` can distill a grounded DECISION entry. Published
      // *before* the early returns below — the decision is recorded regardless of
      // whether write-back fires, and memory must remember it either way.
      bus.publish(
        createEvent(EventType.ReviewDecisionSubmitted, brand(id, 'CorrelationID'), {
          decision_id: decisionId,
          review_report_id: id,
          decision: decision as ReviewDecisionType,
          ...(rationale === undefined ? {} : { rationale }),
        }),
      );

      if (!effective || decision === ReviewDecisionType.RequestChanges) {
        // OFF — nothing external, provably. REQUEST_CHANGES never writes even with
        // the toggle ON (day-09 §6: only APPROVE/REJECT trigger a write).
        return {
          reportId: id,
          decision,
          decisionId,
          writeback:
            decision === ReviewDecisionType.RequestChanges
              ? { emitted: 0, reason: 'REQUEST_CHANGES has no external write-back' }
              : false,
        };
      }

      const { host } = parseRepoPath(report.repo);
      const provider = getGitToolMap().resolveHost(host);
      if (provider === undefined) {
        return reply.code(422).send({ error: `write-back unsupported for repo host "${host}"` });
      }

      const writeback = container.resolve<WriteBackService>(TOKENS.WriteBackService);
      const approved = decision === ReviewDecisionType.Approve;
      const isReject = decision === ReviewDecisionType.Reject;
      const decisionSummary = `Review decision: ${decision}${rationale === undefined ? '' : ` — ${rationale}`}`;
      const userComment = comment;

      let commentBody: string;
      if (isReject) {
        // For REJECT, attach full AI review findings and suggestions alongside human comments
        const [findingsRows, suggestionsRows] = await Promise.all([
          db
            .select()
            .from(reviewFindings)
            .where(eq(reviewFindings.report_id, id))
            .orderBy(asc(reviewFindings.order_index)),
          db
            .select()
            .from(fixSuggestions)
            .where(eq(fixSuggestions.report_id, id))
            .orderBy(asc(fixSuggestions.order_index)),
        ]);

        commentBody = formatRejectWritebackBody({
          decision,
          rationale,
          userComment: userComment && userComment.length > 0 ? userComment : undefined,
          summary: report.summary,
          findings: findingsRows,
          suggestions: suggestionsRows,
        });
      } else {
        commentBody = userComment && userComment.length > 0 ? userComment : decisionSummary;
      }

      const commentIntent: WriteBackIntent = {
        id: deterministicWritebackId(decisionId, 'comment'),
        provider,
        externalId: String(report.pr_number),
        action: WritebackAction.Comment,
        body: commentBody,
        repo: report.repo,
        decisionId,
      };
      const statusIntent: WriteBackIntent = {
        id: deterministicWritebackId(decisionId, 'status'),
        provider,
        externalId: String(report.pr_number),
        action: WritebackAction.Status,
        state: approved ? 'success' : 'failure',
        body: decisionSummary,
        repo: report.repo,
        decisionId,
      };

      // P0 fix: saga-style — comment then status. If status fails after a
      // successful comment, return 207 (partial) with the comment result so a
      // retry with the same payload hits the idempotency path above and resumes
      // only the missing status (writeback_log dedup catches the comment).
      try {
        const comment = await writeback.write(commentIntent);
        try {
          const status = await writeback.write(statusIntent);
          return { reportId: id, decision, decisionId, writeback: { comment, status } };
        } catch (statusError) {
          if (statusError instanceof WriteBackError) {
            return reply
              .code(207)
              .send({ reportId: id, decision, decisionId, writeback: { comment, statusError: statusError.message } });
          }
          throw statusError;
        }
      } catch (error) {
        if (error instanceof WriteBackError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    },
  );
}
