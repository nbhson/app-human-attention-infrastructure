/**
 * Persistence stage for the review-ingest slice: project get-or-create, report
 * row plumbing, and the finding/fix-suggestion row builders shared by the sync
 * ingest path and the async progressive-batch path.
 */

import { eq } from 'drizzle-orm';

import { brand, FindingKind, newFixSuggestionID, newProjectID, newReviewFindingID } from '@harness/domain';
import type {
  AiProviderType,
  PRHealthScore,
  ProjectID,
  PullRequest,
  PullRequestFile,
  ReviewReportID,
  TaskID,
} from '@harness/domain';
import { fixSuggestions, projects, reviewFindings, reviewReports } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import { withDeterministicTestingScore } from '../../review-health.js';

import type { ReviewAgentOutput } from '@harness/agent-runtime';
import type { Logger } from '@harness/di';

import { retryTransient } from './retry.js';

/** P1 fix: resolve the real anchor task id so async + sync paths share one trail. */
export async function resolveReportTaskId(db: DrizzleDB, reportId: ReviewReportID): Promise<TaskID> {
  try {
    const rows = await db
      .select({ taskId: reviewReports.task_id })
      .from(reviewReports)
      .where(eq(reviewReports.id, reportId))
      .limit(1);
    const taskId = rows[0]?.taskId;
    if (typeof taskId === 'string' && taskId.length > 0) return brand(taskId, 'TaskID');
  } catch {
    // Fall through to the report-keyed fallback — provenance must never block.
  }
  return brand(reportId, 'TaskID');
}

/** Get-or-create the owning project by repo slug (same idempotent pattern as the task route). */
export async function getOrCreateProject(db: DrizzleDB, repo: string): Promise<ProjectID> {
  const rows = await db.select({ id: projects.id }).from(projects).where(eq(projects.repo_path, repo)).limit(1);
  const existing = rows[0];
  if (existing) {
    return brand(existing.id, 'ProjectID');
  }
  const id = newProjectID();
  await db.insert(projects).values({ id, name: repo, repo_path: repo });
  return id;
}

/** Map one agent finding to its `review_findings` insert row. */
function findingRow(reportId: ReviewReportID, orderIndex: number, finding: ReviewAgentOutput['findings'][number]) {
  return {
    id: newReviewFindingID(),
    report_id: reportId,
    severity: finding.severity,
    kind: finding.kind ?? FindingKind.Correctness,
    file: finding.file,
    line: finding.line ?? null,
    message: finding.message,
    suggestion: finding.suggestion ?? null,
    order_index: orderIndex,
  };
}

/** Map one agent suggestion to its `fix_suggestions` insert row. */
function suggestionRow(
  reportId: ReviewReportID,
  orderIndex: number,
  suggestion: ReviewAgentOutput['suggestions'][number],
) {
  return {
    id: newFixSuggestionID(),
    report_id: reportId,
    file: suggestion.file,
    hunk: suggestion.hunk ?? null,
    proposed: suggestion.proposed,
    rationale: suggestion.rationale,
    order_index: orderIndex,
  };
}

/**
 * Batch-insert one batch's findings + suggestions (two queries instead of N+1
 * round-trips), advancing the caller's running order-index offsets.
 */
export async function insertBatchFindingsAndSuggestions(
  db: DrizzleDB,
  reportId: ReviewReportID,
  output: ReviewAgentOutput,
  offsets: { findingOffset: number; suggestionOffset: number },
): Promise<void> {
  const findingRows = output.findings.map((finding) => findingRow(reportId, offsets.findingOffset++, finding));
  const suggestionRows = output.suggestions.map((suggestion) =>
    suggestionRow(reportId, offsets.suggestionOffset++, suggestion),
  );
  if (findingRows.length > 0) {
    await db.insert(reviewFindings).values(findingRows);
  }
  if (suggestionRows.length > 0) {
    await db.insert(fixSuggestions).values(suggestionRows);
  }
}

/** The subset of `review_reports` columns the ingest pipeline writes mid-flight. */
export interface ReviewReportPatch {
  review_status?: string;
  summary?: string;
  overall_verdict?: string;
  completed_at?: Date;
  pr_payload?: unknown;
  recalled_memories?: unknown;
  batch_progress?: { current: number; total: number } | null;
  was_repaired?: boolean;
  health_score?: PRHealthScore | null;
}

/**
 * Update the report row with transient-failure retry. `label` names the stage
 * for the retry log ("status fetching", "status recalling", …).
 */
export async function updateReportStatus(
  db: DrizzleDB,
  logger: Logger,
  reportId: ReviewReportID,
  label: string,
  patch: ReviewReportPatch,
): Promise<void> {
  await retryTransient(
    label,
    () =>
      db
        .update(reviewReports)
        .set({
          ...(patch.review_status !== undefined ? { review_status: patch.review_status } : {}),
          ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
          ...(patch.overall_verdict !== undefined ? { overall_verdict: patch.overall_verdict } : {}),
          ...(patch.completed_at !== undefined ? { completed_at: patch.completed_at } : {}),
          ...(patch.pr_payload !== undefined ? { pr_payload: patch.pr_payload } : {}),
          ...(patch.recalled_memories !== undefined ? { recalled_memories: patch.recalled_memories } : {}),
          ...(patch.batch_progress !== undefined ? { batch_progress: patch.batch_progress } : {}),
          ...(patch.was_repaired !== undefined ? { was_repaired: patch.was_repaired } : {}),
          ...(patch.health_score !== undefined ? { health_score: patch.health_score } : {}),
        })
        .where(eq(reviewReports.id, reportId)),
    logger,
    reportId,
  );
}

/** Common provenance fields shared by the placeholder + completed report rows. */
function reportProvenance(
  reportId: ReviewReportID,
  taskId: TaskID,
  pr: PullRequest,
  repo: string,
  aiProvider: AiProviderType,
  model: string,
) {
  return {
    id: reportId,
    task_id: taskId,
    correlation_id: taskId,
    pr_url: pr.url,
    pr_number: pr.number,
    repo,
    pr_title: pr.title,
    ai_provider: aiProvider,
    model,
  };
}

/**
 * Create the report row with placeholder data (async path) so the frontend can
 * poll it while the AI review runs in the background.
 */
export async function insertPlaceholderReport(
  db: DrizzleDB,
  input: {
    reportId: ReviewReportID;
    taskId: TaskID;
    pr: PullRequest;
    repo: string;
    aiProvider: AiProviderType;
    model: string;
  },
): Promise<void> {
  const { reportId, taskId, pr, repo, aiProvider, model } = input;
  await db.insert(reviewReports).values({
    ...reportProvenance(reportId, taskId, pr, repo, aiProvider, model),
    summary: '⏳ Review is being processed...',
    overall_verdict: 'COMMENT' as const,
    pr_payload: pr,
    health_score: null,
  });
}

/**
 * Insert the completed report row (sync ingest path). The AI miscounts the
 * test-to-source ratio from diff text (e.g. poor/1 with two *.spec.ts files in
 * the diff) — recompute `testing` from the file list so the stored score
 * matches the Detail tab rubric.
 */
export async function insertCompletedReport(
  db: DrizzleDB,
  input: {
    reportId: ReviewReportID;
    taskId: TaskID;
    pr: PullRequest;
    repo: string;
    aiProvider: AiProviderType;
    model: string;
    agentOutput: ReviewAgentOutput;
  },
): Promise<void> {
  const { reportId, taskId, pr, repo, aiProvider, model, agentOutput } = input;
  await db.insert(reviewReports).values({
    ...reportProvenance(reportId, taskId, pr, repo, aiProvider, model),
    summary: agentOutput.summary,
    overall_verdict: agentOutput.overallVerdict,
    pr_payload: pr,
    review_status: 'complete',
    completed_at: new Date(),
    was_repaired: agentOutput.wasRepaired === true,
    health_score: deterministicHealthScore(agentOutput, pr.files),
  });
}

/** Finalise the async report row with the merged summary + verdict. */
export async function markReportComplete(
  db: DrizzleDB,
  logger: Logger,
  reportId: ReviewReportID,
  agentOutput: ReviewAgentOutput,
  files: readonly PullRequestFile[],
): Promise<void> {
  await updateReportStatus(db, logger, reportId, 'status complete', {
    summary: agentOutput.summary,
    overall_verdict: agentOutput.overallVerdict,
    review_status: 'complete',
    completed_at: new Date(),
    batch_progress: null,
    was_repaired: agentOutput.wasRepaired === true,
    health_score: deterministicHealthScore(agentOutput, files),
  });
}

/**
 * Same deterministic testing override on both sync + async paths: recompute
 * `testing` from the changed-file list instead of trusting the AI's count.
 */
function deterministicHealthScore(
  agentOutput: ReviewAgentOutput,
  files: readonly PullRequestFile[],
): PRHealthScore | null {
  return (
    withDeterministicTestingScore(
      agentOutput.healthScore,
      files.map((file) => file.path),
    ) ?? null
  );
}
