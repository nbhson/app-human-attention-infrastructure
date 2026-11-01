/**
 * `GET /api/reviews/:id` — the stored report + findings + fix suggestions +
 * stats + AI trace (LLM calls / judge runs) + decisions/write-backs + the
 * machine-side verification row. The projection the web UI's Detail page renders.
 */

import type { FastifyInstance } from 'fastify';

import { asc, eq, inArray } from 'drizzle-orm';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { Role } from '@harness/domain';
import type { ReviewReportID } from '@harness/domain';
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

import { computeFindingAnchor } from '../finding-anchor.js';
import { normalizePrFiles } from '../pr-files.js';
import { withDeterministicTestingScore } from '../review-health.js';
import { computeReviewStats } from '../review-stats.js';
import { prFilePathsFromPayload } from '../list-summary.js';
import { computeTriage } from '../triage-rules.js';
import { loadTriageRuleState } from '../triage-rules-store.js';
import { writebackEnabled } from '../writeback-gate.js';

interface RecalledMemory {
  readonly kind: string;
  readonly content: string;
  readonly confidence: number;
  readonly metadata: Record<string, unknown>;
  readonly relevance: number;
}

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

/** Register `GET /api/reviews/:id` (the full report projection). */
export function registerReviewDetailRoute(app: FastifyInstance, container: Container): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);

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
        wasRepaired: report.was_repaired === true,
        batchProgress: (report.batch_progress as { current: number; total: number } | null) ?? null,
        effectiveVerdict: triage.effectiveVerdict ?? report.overall_verdict,
        triage: {
          securityBlocked: triage.securityBlocked,
          regressionRisk: triage.regressionRisk,
          schemaGate: triage.schemaGate,
          matchedRules: triage.matchedRules,
        },
        createdAt: report.created_at,
        // Null while the pipeline is still in flight; set when it reaches
        // `complete`/`error` (and cleared on retry). The UI derives the
        // "completed in …" display from `completedAt - createdAt`.
        completedAt: report.completed_at ?? null,
        // The server's *current* write-back arming (the WRITEBACK_ENABLED ceiling).
        // The UI uses this to disable + explain the "write back" checkbox rather
        // than letting an operator tick it and silently record OFF. The
        // per-provider WRITEBACK_<PROVIDER> arm is a further, host-level gate
        // still enforced at decision time.
        writeback: { enabled: writebackEnabled(true, process.env) },
        recalledMemories: (report.recalled_memories as unknown as readonly RecalledMemory[] | null) ?? null,
        pullRequestMetadata: (report.pr_payload as { commits?: unknown; checkStatus?: unknown })
          ? {
              commits: (report.pr_payload as { commits?: unknown }).commits,
              checkStatus: (report.pr_payload as { checkStatus?: unknown }).checkStatus,
            }
          : undefined,
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
        // v5 health score: AI-assessed 1–100 per dimension, stored in
        // `review_reports.health_score`. Legacy reports have NULL → undefined so
        // the Detail tab renders its honest empty state. The `testing`
        // dimension is recomputed from the file list on every read: the model
        // miscounts the test-to-source ratio from diff text, and this also
        // corrects rows stored before the ingest-side override existed.
        healthScore:
          withDeterministicTestingScore(
            report.health_score as unknown as Record<string, unknown> | null,
            normalizePrFiles(report.pr_payload).map((file) => file.path),
          ) ?? undefined,
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
}
