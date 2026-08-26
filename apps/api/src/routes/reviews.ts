/**
 * Review-slice HTTP routes (review-reorient Phase 3) — the thin Fastify surface
 * over {@link ReviewIngestService} and the `review_reports` projection.
 *
 * Four endpoints:
 *  - `POST   /api/reviews`           paste a PR URL (+ optional Jira ticket) → AI review
 *  - `GET    /api/reviews`           list reports (+ optional ?pending=1 to keep only the un-decided)
 *  - `GET    /api/reviews/:id`       the stored report + findings + fix suggestions
 *  - `POST   /api/reviews/:id/decision` the human's approve/reject/request-changes call.
 *    Persists a `review_decisions` row (with the effective write-back toggle for
 *    audit) and, when the toggle is ON and the verdict is APPROVE/REJECT, posts a
 *    COMMENT + STATUS back to the PR through the WriteBackService seam (day-09).
 *
 * All three are guarded with {@link requireRole}: ingesting and reading a report
 * require any authenticated principal (`Operate`), while the human decision
 * (which can trigger a PR write-back) requires `Reviewer`/`Admin`.
 */

import type { FastifyInstance } from 'fastify';

import { asc, desc, eq, inArray } from 'drizzle-orm';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import {
  newDecisionID,
  newWritebackID,
  ReviewDecisionType,
  Role,
  WritebackAction,
} from '@harness/domain';
import type { ReviewReportID, WriteBackIntent } from '@harness/domain';
import {
  fixSuggestions,
  judgeRuns,
  llmCallLog,
  reviewDecisions,
  reviewFindings,
  reviewReports,
  writebackLog,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { parseRepoPath, StaticGitToolMap } from '@harness/git-provider';
import { WriteBackError } from '@harness/writeback';
import type { WriteBackService } from '@harness/writeback';

import { ReviewIngestError, ReviewIngestService } from '../services/review-ingest.js';
import { computeFindingAnchor } from '../finding-anchor.js';
import { computeReviewStats } from '../review-stats.js';
import { writebackEnabled } from '../writeback-gate.js';
import { normalizePrFiles } from '../pr-files.js';

/** The per-host tool map, reused to resolve a report's repo slug to a write-back host. */
const GIT_TOOL_MAP = new StaticGitToolMap();

interface CreateReviewBody {
  readonly prUrl?: string;
  readonly jiraTicket?: string;
}

interface DecideBody {
  readonly decision?: string;
  readonly rationale?: string;
  /** When true, write a review comment back to the PR (behind the write-back toggle). */
  readonly writeback?: boolean;
  /** Optional comment text for the write-back; defaults to a decision summary. */
  readonly comment?: string;
}

const DECISIONS = new Set<string>(Object.values(ReviewDecisionType));

/** Register the review endpoints under `/api/reviews`. */
export function registerReviewIngestRoutes(app: FastifyInstance, container: Container): void {
  const ingest = container.resolve<ReviewIngestService>(TOKENS.ReviewIngestService);
  const db = container.resolve<DrizzleDB>(TOKENS.Db);

  app.post<{ Body: CreateReviewBody }>(
    '/api/reviews',
    { preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) },
    async (request, reply) => {
      try {
        const { prUrl, jiraTicket } = request.body ?? {};
        if (typeof prUrl !== 'string' || prUrl.trim().length === 0) {
          return reply.code(400).send({ error: 'prUrl is required' });
        }
        const result = await ingest.ingest({
          prUrl: prUrl.trim(),
          ...(typeof jiraTicket === 'string' && jiraTicket.trim().length > 0
            ? { jiraTicket: jiraTicket.trim() }
            : {}),
        });
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof ReviewIngestError) {
          return reply.code(error.status).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: { pending?: string } }>(
    '/api/reviews',
    { preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) },
    async (request) => {
      const rows = await db.select().from(reviewReports).orderBy(desc(reviewReports.created_at));
      const ids = rows.map((row) => row.id);
      const decidedRows =
        ids.length === 0
          ? []
          : await db
              .select({ reportId: reviewDecisions.report_id })
              .from(reviewDecisions)
              .where(inArray(reviewDecisions.report_id, ids));
      const decidedIds = new Set(decidedRows.map((row) => row.reportId));
      const pendingOnly = request.query.pending === '1' || request.query.pending === 'true';
      return rows
        .filter((row) => (pendingOnly ? !decidedIds.has(row.id) : true))
        .map((row) => ({
          id: row.id,
          prUrl: row.pr_url,
          prNumber: row.pr_number,
          repo: row.repo,
          prTitle: row.pr_title,
          overallVerdict: row.overall_verdict,
          createdAt: row.created_at,
          decided: decidedIds.has(row.id),
        }));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/reviews/:id',
    { preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) },
    async (request, reply) => {
      const id = request.params.id as ReviewReportID;
      const reportRows = await db
        .select()
        .from(reviewReports)
        .where(eq(reviewReports.id, id))
        .limit(1);
      const report = reportRows[0];
      if (!report) {
        return reply.code(404).send({ error: 'review report not found' });
      }
      const findingsRows = await db
        .select()
        .from(reviewFindings)
        .where(eq(reviewFindings.report_id, id))
        .orderBy(asc(reviewFindings.order_index));
      const suggestionsRows = await db
        .select()
        .from(fixSuggestions)
        .where(eq(fixSuggestions.report_id, id))
        .orderBy(asc(fixSuggestions.order_index));

      const llmRows =
        report.correlation_id !== null && report.correlation_id !== undefined
          ? await db
              .select()
              .from(llmCallLog)
              .where(eq(llmCallLog.correlation_id, report.correlation_id))
              .orderBy(asc(llmCallLog.created_at))
          : [];
      const judgeRows = await db
        .select()
        .from(judgeRuns)
        .where(eq(judgeRuns.report_id, id))
        .orderBy(asc(judgeRuns.created_at));
      const decisionRows = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.report_id, id))
        .orderBy(asc(reviewDecisions.created_at));
      const decisionIds = decisionRows.map((row) => row.id);
      const writebackRows =
        decisionIds.length === 0
          ? []
          : await db
              .select()
              .from(writebackLog)
              .where(inArray(writebackLog.decision_id, decisionIds))
              .orderBy(asc(writebackLog.created_at));

      return {
        id: report.id,
        prUrl: report.pr_url,
        prNumber: report.pr_number,
        repo: report.repo,
        prTitle: report.pr_title,
        aiProvider: report.ai_provider,
        model: report.model,
        summary: report.summary,
        overallVerdict: report.overall_verdict,
        createdAt: report.created_at,
        // The server's *current* write-back arming (the WRITEBACK_ENABLED ceiling).
        // The UI uses this to disable + explain the "write back" checkbox rather
        // than letting an operator tick it and silently record OFF. The
        // per-provider WRITEBACK_<PROVIDER> arm is a further, host-level gate
        // still enforced at decision time.
        writeback: { enabled: writebackEnabled(true) },
        stats: computeReviewStats(report.pr_payload, findingsRows),
        findings: findingsRows.map((f) => ({
          id: f.id,
          severity: f.severity,
          kind: f.kind,
          file: f.file,
          line: f.line,
          anchor: computeFindingAnchor(report.pr_payload, f.file, f.line),
          message: f.message,
          suggestion: f.suggestion,
          orderIndex: f.order_index,
        })),
        suggestions: suggestionsRows.map((s) => ({
          id: s.id,
          file: s.file,
          hunk: s.hunk,
          proposed: s.proposed,
          rationale: s.rationale,
          orderIndex: s.order_index,
        })),
        diff: normalizePrFiles(report.pr_payload),
        trace: {
          calls: llmRows.map((row) => ({
            model: row.model,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            stopReason: row.stop_reason,
            requestHash: row.request_hash,
            createdAt: row.created_at,
          })),
          judge: judgeRows.map((row) => ({
            model: row.model,
            promptVersion: row.prompt_version,
            temperature: row.temperature,
            severityAgreement: row.severity_agreement,
            routingAgreement: row.routing_agreement,
            evidenceSufficiency: row.evidence_sufficiency,
            overall: row.overall,
            reasoning: row.reasoning,
            createdAt: row.created_at,
          })),
        },
        decisions: decisionRows.map((row) => ({
          id: row.id,
          decision: row.decision,
          rationale: row.rationale,
          writebackEnabled: row.writeback_enabled,
          createdAt: row.created_at,
        })),
        writebacks: writebackRows.map((row) => ({
          id: row.id,
          provider: row.provider,
          action: row.action,
          status: row.status,
          externalRef: row.external_ref,
          error: row.error,
          decisionId: row.decision_id,
          createdAt: row.created_at,
        })),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: DecideBody }>(
    '/api/reviews/:id/decision',
    { preHandler: requireRole(container, Role.Reviewer, Role.Admin) },
    async (request, reply) => {
      const id = request.params.id as ReviewReportID;
      const { decision } = request.body ?? {};
      if (typeof decision !== 'string' || !DECISIONS.has(decision)) {
        return reply.code(400).send({
          error: 'decision must be one of APPROVE, REQUEST_CHANGES, REJECT',
        });
      }

      const reportRows = await db
        .select()
        .from(reviewReports)
        .where(eq(reviewReports.id, id))
        .limit(1);
      const report = reportRows[0];
      if (!report) {
        return reply.code(404).send({ error: 'review report not found' });
      }

      const rationale =
        typeof request.body?.rationale === 'string' && request.body.rationale.trim().length > 0
          ? request.body.rationale.trim()
          : undefined;

      // The effective write-back gate: request-level flag AND env ceiling. An
      // unset env, a missing flag, or either steam OFF all fail safe (day-09 §2.1).
      const effective = writebackEnabled(request.body?.writeback);

      // Persist the decision with its toggle state so "nothing was written" is an
      // auditable fact, not an absence (day-09 §1 goal 3).
      const decisionId = newDecisionID();
      await db.insert(reviewDecisions).values({
        id: decisionId,
        report_id: id,
        decision,
        ...(rationale === undefined ? {} : { rationale }),
        writeback_enabled: effective,
      });

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
      const provider = GIT_TOOL_MAP.resolveHost(host);
      if (provider === undefined) {
        return reply.code(422).send({ error: `write-back unsupported for repo host "${host}"` });
      }

      const writeback = container.resolve<WriteBackService>(TOKENS.WriteBackService);
      const approved = decision === ReviewDecisionType.Approve;
      const decisionSummary = `Review decision: ${decision}${
        rationale === undefined ? '' : ` — ${rationale}`
      }`;
      const userComment = request.body?.comment?.trim();
      const commentBody = userComment && userComment.length > 0 ? userComment : decisionSummary;

      const commentIntent: WriteBackIntent = {
        id: newWritebackID(),
        provider,
        externalId: String(report.pr_number),
        action: WritebackAction.Comment,
        body: commentBody,
        repo: report.repo,
        decisionId,
      };
      const statusIntent: WriteBackIntent = {
        id: newWritebackID(),
        provider,
        externalId: String(report.pr_number),
        action: WritebackAction.Status,
        state: approved ? 'success' : 'failure',
        body: decisionSummary,
        repo: report.repo,
        decisionId,
      };

      try {
        const comment = await writeback.write(commentIntent);
        const status = await writeback.write(statusIntent);
        return { reportId: id, decision, decisionId, writeback: { comment, status } };
      } catch (error) {
        if (error instanceof WriteBackError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    },
  );
}
