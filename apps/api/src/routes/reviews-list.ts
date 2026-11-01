/**
 * `GET /api/reviews` + `GET /api/reviews/summary` — the list surface of the
 * review slice. List rows carry the per-review triage/risk summary the queue
 * cards render (findings, risk score, effective verdict); `/summary` returns
 * the aggregate pending/decided/approved counts.
 */

import type { FastifyInstance } from 'fastify';

import { asc, count, desc, inArray, sql } from 'drizzle-orm';

import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { Role } from '@harness/domain';
import { reviewDecisions, reviewFindings, reviewReports } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import {
  prFilePathsFromPayload,
  priorityFromRiskScore,
  riskScoreFromSeverities,
  summaryFromPayload,
} from '../list-summary.js';
import { computeTriage } from '../triage-rules.js';
import { loadTriageRuleState } from '../triage-rules-store.js';

/** One finding in the list's per-review expandable summary (no anchor/suggestion). */
interface ListFindingSummary {
  readonly severity: string;
  readonly kind: string;
  readonly file: string;
  readonly line: number | null;
  readonly message: string;
}

/** Register `GET /api/reviews` and `GET /api/reviews/summary`. */
export function registerReviewListRoutes(app: FastifyInstance, container: Container): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);

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

      const pendingOnly = request.query.pending === '1' || request.query.pending === 'true';

      // `pending=1` filters in SQL (NOT EXISTS) before pagination — stable
      // pages with a single query, no in-memory scan, no duplicates even when
      // a report carries several decision rows.
      const ruleState = await loadTriageRuleState(db);
      const rows = pendingOnly
        ? await db
            .select()
            .from(reviewReports)
            .where(
              sql`not exists (select 1 from ${reviewDecisions} where ${reviewDecisions.report_id} = ${reviewReports.id})`,
            )
            .orderBy(desc(reviewReports.created_at))
            .limit(limit)
            .offset(offset)
        : await db.select().from(reviewReports).orderBy(desc(reviewReports.created_at)).limit(limit).offset(offset);

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
      return rows.map((row) => {
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
      const approvedCount = [...decisionByReport.values()].filter((d) => d === 'APPROVE').length;
      return {
        pendingCount: total - decidedCount,
        decidedCount,
        approvedCount,
      };
    },
  );
}
