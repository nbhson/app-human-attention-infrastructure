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
 *  - `POST   /api/reviews/auto`      AI code review endpoint that returns all
 *    findings (including MINOR/NIT/INFO) when `auto_review_enabled` is ON in
 *    the triage rules. Used by the full code-review mode.
 *
 * All three are guarded with {@link requireRole}: ingesting and reading a report
 * require any authenticated principal (`Operate`), while the human decision
 * (which can trigger a PR write-back) requires `Reviewer`/`Admin`.
 */

import type { FastifyInstance } from 'fastify';

import { asc, count, desc, eq, inArray } from 'drizzle-orm';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import {
  brand,
  EventType,
  newDecisionID,
  newWritebackID,
  ReviewDecisionType,
  Role,
  WritebackAction,
} from '@harness/domain';
import type { ReviewReportID, WriteBackIntent } from '@harness/domain';
import type { ReviewRequestedPayload } from '@harness/domain';
import {
  fixSuggestions,
  judgeRuns,
  llmCallLog,
  reviewDecisions,
  reviewFindings,
  reviewReports,
  reviewVerifications,
  writebackLog,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { GitProviderError, parseRepoPath, StaticGitToolMap } from '@harness/git-provider';
import { WriteBackError } from '@harness/writeback';
import type { WriteBackService } from '@harness/writeback';

import { ReviewIngestError, ReviewIngestService } from '../services/review-ingest.js';
import { computeFindingAnchor } from '../finding-anchor.js';
import { computeReviewStats } from '../review-stats.js';
import { writebackEnabled } from '../writeback-gate.js';
import { normalizePrFiles } from '../pr-files.js';
import {
  priorityFromRiskScore,
  prFilePathsFromPayload,
  riskScoreFromSeverities,
  summaryFromPayload,
} from '../list-summary.js';
import { computeTriage } from '../triage-rules.js';
import { loadTriageRuleState } from '../triage-rules-store.js';
import type { ReviewDecideBody } from './shared-types.js';

/** The per-host tool map, reused to resolve a report's repo slug to a write-back host. */
const GIT_TOOL_MAP = new StaticGitToolMap();

interface CreateReviewBody {
  readonly prUrl?: string;
  readonly jiraTicket?: string;
}

const DECISIONS = new Set<string>(Object.values(ReviewDecisionType));

/** The `review_verifications.flag` JSON shape (a persisted {@link VerificationFlag}). */
interface StoredVerificationFlag {
  readonly failedKinds?: readonly string[];
  readonly timedOutKinds?: readonly string[];
  readonly failedChecks?: readonly {
    readonly kind: string;
    readonly status: string;
    readonly exitCode?: number;
    readonly evidenceRef?: string;
    readonly tail: string;
  }[];
}

/** One finding in the list's per-review expandable summary (no anchor/suggestion). */
interface ListFindingSummary {
  readonly severity: string;
  readonly kind: string;
  readonly file: string;
  readonly line: number | null;
  readonly message: string;
}

/** Register the review endpoints under `/api/reviews`. */
export function registerReviewIngestRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimit?: (ip: string) => boolean,
): void {
  const ingest = container.resolve<ReviewIngestService>(TOKENS.ReviewIngestService);
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const bus = container.resolve<IEventBus>(TOKENS.EventBus);

  app.post<{ Body: CreateReviewBody }>(
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
      try {
        const { prUrl, jiraTicket } = request.body ?? {};
        if (typeof prUrl !== 'string' || prUrl.trim().length === 0) {
          return reply.code(400).send({ error: 'prUrl is required' });
        }
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

  app.get<{ Querystring: { pending?: string; limit?: string; offset?: string } }>(
    '/api/reviews',
    { preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) },
    async (request) => {
      const limit = (() => {
        const n = Number.parseInt(request.query.limit ?? '', 10);
        return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 20;
      })();
      const offset = (() => {
        const n = Number.parseInt(request.query.offset ?? '', 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      })();

      // Fetch reports + rule state in parallel — rule state is independent of pagination.
      const [rows, ruleState] = await Promise.all([
        db.select().from(reviewReports).orderBy(desc(reviewReports.created_at)).limit(limit).offset(offset),
        loadTriageRuleState(db),
      ]);

      const ids = rows.map((row) => row.id);
      // Fetch decisions and findings in parallel — both depend only on `ids`.
      const [decidedRows, findingRows] =
        ids.length === 0
          ? [[], []]
          : await Promise.all([
              db
                .select({
                  reportId: reviewDecisions.report_id,
                  decision: reviewDecisions.decision,
                })
                .from(reviewDecisions)
                .where(inArray(reviewDecisions.report_id, ids))
                .orderBy(asc(reviewDecisions.created_at)),
              db
                .select({
                  reportId: reviewFindings.report_id,
                  severity: reviewFindings.severity,
                  kind: reviewFindings.kind,
                  file: reviewFindings.file,
                  line: reviewFindings.line,
                  message: reviewFindings.message,
                })
                .from(reviewFindings)
                .where(inArray(reviewFindings.report_id, ids))
                .orderBy(asc(reviewFindings.order_index)),
            ]);

      const decidedIds = new Set<string>();
      const decisionByReport = new Map<string, string>();
      for (const row of decidedRows) {
        decidedIds.add(row.reportId);
        decisionByReport.set(row.reportId, row.decision);
      }
      const findingsByReport = new Map<string, ListFindingSummary[]>();
      for (const row of findingRows) {
        const list = findingsByReport.get(row.reportId) ?? [];
        list.push({
          severity: row.severity,
          kind: row.kind,
          file: row.file,
          line: row.line,
          message: row.message,
        });
        findingsByReport.set(row.reportId, list);
      }
      const pendingOnly = request.query.pending === '1' || request.query.pending === 'true';
      return rows
        .filter((row) => (pendingOnly ? !decidedIds.has(row.id) : true))
        .map((row) => {
          const payload = summaryFromPayload(row.pr_payload);
          const findings = findingsByReport.get(row.id) ?? [];
          const riskScore = riskScoreFromSeverities(findings.map((finding) => finding.severity));
          const triage = computeTriage({
            rules: ruleState,
            findings,
            prFilePaths: prFilePathsFromPayload(row.pr_payload),
          });
          return {
            id: row.id,
            prUrl: row.pr_url,
            prNumber: row.pr_number,
            repo: row.repo,
            prTitle: row.pr_title,
            overallVerdict: row.overall_verdict,
            createdAt: row.created_at,
            decided: decidedIds.has(row.id),
            decision: decisionByReport.get(row.id) ?? null,
            findingCount: findings.length,
            author: payload.author,
            branch: { source: payload.sourceBranch, target: payload.targetBranch },
            additions: payload.additions,
            deletions: payload.deletions,
            filesChanged: payload.filesChanged,
            riskScore,
            priority: priorityFromRiskScore(riskScore),
            criticalFindings: findings.filter((finding) => finding.severity === 'CRITICAL').length,
            findings,
            triage: {
              securityBlocked: triage.securityBlocked,
              schemaGate: triage.schemaGate,
              matchedRules: triage.matchedRules,
            },
            effectiveVerdict: triage.effectiveVerdict ?? row.overall_verdict,
          };
        });
    },
  );

  app.get(
    '/api/reviews/summary',
    { preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) },
    async () => {
      // Two lightweight aggregate queries instead of loading all rows into memory.
      const totalRow = await db.select({ total: count() }).from(reviewReports);
      const total = totalRow[0]?.total ?? 0;
      const decidedRows = await db
        .select({ reportId: reviewDecisions.report_id, decision: reviewDecisions.decision })
        .from(reviewDecisions);
      const decisionByReport = new Map<string, string>();
      for (const row of decidedRows) {
        decisionByReport.set(row.reportId, row.decision);
      }
      const decidedCount = decisionByReport.size;
      const approvedCount = [...decisionByReport.entries()]
        .filter(([, d]) => d === 'APPROVE')
        .map(([id]) => id)
        .filter((id, idx, arr) => arr.indexOf(id) === idx).length;
      return {
        pendingCount: total - decidedCount,
        decidedCount,
        approvedCount,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/reviews/:id',
    { preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) },
    async (request, reply) => {
      const id = request.params.id as ReviewReportID;
      const reportRows = await db.select().from(reviewReports).where(eq(reviewReports.id, id)).limit(1);
      const report = reportRows[0];
      if (!report) {
        return reply.code(404).send({ error: 'review report not found' });
      }

      // All subsidiary queries are independent — run them in parallel.
      const [findingsRows, suggestionsRows, llmRows, judgeRows, decisionRows, verificationRows, ruleState] =
        await Promise.all([
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
          report.correlation_id !== null && report.correlation_id !== undefined
            ? db
                .select()
                .from(llmCallLog)
                .where(eq(llmCallLog.correlation_id, report.correlation_id))
                .orderBy(asc(llmCallLog.created_at))
            : [],
          db.select().from(judgeRuns).where(eq(judgeRuns.report_id, id)).orderBy(asc(judgeRuns.created_at)),
          db
            .select()
            .from(reviewDecisions)
            .where(eq(reviewDecisions.report_id, id))
            .orderBy(asc(reviewDecisions.created_at)),
          db.select().from(reviewVerifications).where(eq(reviewVerifications.report_id, id)).limit(1),
          loadTriageRuleState(db),
        ]);

      const decisionIds = decisionRows.map((row) => row.id);
      const writebackRows =
        decisionIds.length === 0
          ? []
          : await db
              .select()
              .from(writebackLog)
              .where(inArray(writebackLog.decision_id, decisionIds))
              .orderBy(asc(writebackLog.created_at));

      const verificationRow = verificationRows[0] ?? null;
      const verificationFlag = (verificationRow?.flag ?? null) as StoredVerificationFlag | null;

      const triage = computeTriage({
        rules: ruleState,
        findings: findingsRows,
        prFilePaths: prFilePathsFromPayload(report.pr_payload),
        judgeRuns: judgeRows.map((row) => ({ overall: row.overall })),
      });

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
        reviewStatus: report.review_status ?? 'pending',
        batchProgress: (report.batch_progress as { current: number; total: number } | null) ?? null,
        effectiveVerdict: triage.effectiveVerdict ?? report.overall_verdict,
        triage: {
          securityBlocked: triage.securityBlocked,
          regressionRisk: triage.regressionRisk,
          schemaGate: triage.schemaGate,
          matchedRules: triage.matchedRules,
        },
        createdAt: report.created_at,
        // The server's *current* write-back arming (the WRITEBACK_ENABLED ceiling).
        // The UI uses this to disable + explain the "write back" checkbox rather
        // than letting an operator tick it and silently record OFF. The
        // per-provider WRITEBACK_<PROVIDER> arm is a further, host-level gate
        // still enforced at decision time.
        writeback: { enabled: writebackEnabled(true, process.env) },
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
        // The machine-side verification (wedge #1): null when no run has been
        // recorded yet (e.g. the report predates this field, or verification is
        // disabled and no row was written). The UI renders the honest status —
        // PENDING/RUNNING/PASSED/FAILED/SKIPPED/ERROR — with the failed/timed-out
        // breakdown when the run failed.
        verification:
          verificationRow === null
            ? null
            : {
                status: verificationRow.status,
                overall: verificationRow.overall as 'PASSED' | 'FAILED' | null,
                headSha: verificationRow.head_sha,
                contentHash: verificationRow.content_hash,
                durationMs: verificationRow.duration_ms,
                failedKinds: verificationFlag?.failedKinds ?? [],
                timedOutKinds: verificationFlag?.timedOutKinds ?? [],
                failedChecks: (verificationFlag?.failedChecks ?? []).map((check) => ({
                  kind: check.kind,
                  status: check.status,
                  ...(check.exitCode === undefined ? {} : { exitCode: check.exitCode }),
                  tail: check.tail,
                })),
                rendered: verificationRow.rendered,
                error: verificationRow.error,
              },
      };
    },
  );

  // Auto-review endpoint — returns a full code review (all severities) when
  // auto_review_enabled is ON in the triage rules. This is a separate endpoint
  // from POST /api/reviews because it bypasses the async event-driven flow and
  // returns results synchronously for use by the UI's auto-review mode.
  app.post<{ Body: CreateReviewBody }>(
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
      try {
        const { prUrl, jiraTicket } = request.body ?? {};
        if (typeof prUrl !== 'string' || prUrl.trim().length === 0) {
          return reply.code(400).send({ error: 'prUrl is required' });
        }

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

  app.post<{ Params: { id: string }; Body: ReviewDecideBody }>(
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

      const reportRows = await db.select().from(reviewReports).where(eq(reviewReports.id, id)).limit(1);
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
      const provider = GIT_TOOL_MAP.resolveHost(host);
      if (provider === undefined) {
        return reply.code(422).send({ error: `write-back unsupported for repo host "${host}"` });
      }

      const writeback = container.resolve<WriteBackService>(TOKENS.WriteBackService);
      const approved = decision === ReviewDecisionType.Approve;
      const decisionSummary = `Review decision: ${decision}${rationale === undefined ? '' : ` — ${rationale}`}`;
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

  // ── POST /api/reviews/:id/retry ──────────────────────────────────────────
  // Reset a failed report to pending, clear stale findings/suggestions, and
  // re-publish the review.requested event so the background worker re-runs.
  app.post<{ Params: { id: string } }>(
    '/api/reviews/:id/retry',
    { preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) },
    async (request, reply) => {
      const id = request.params.id as ReviewReportID;
      const reportRows = await db.select().from(reviewReports).where(eq(reviewReports.id, id)).limit(1);
      const report = reportRows[0];
      if (!report) {
        return reply.code(404).send({ error: 'review report not found' });
      }
      if (report.review_status !== 'error') {
        return reply.code(400).send({ error: 'only failed reports can be retried' });
      }

      // 1. Clear stale findings + suggestions.
      await db.delete(reviewFindings).where(eq(reviewFindings.report_id, id));
      await db.delete(fixSuggestions).where(eq(fixSuggestions.report_id, id));

      // 2. Reset report status to pending.
      await db
        .update(reviewReports)
        .set({
          review_status: 'pending',
          summary: '',
          overall_verdict: 'COMMENT',
          batch_progress: null,
        })
        .where(eq(reviewReports.id, id));

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
