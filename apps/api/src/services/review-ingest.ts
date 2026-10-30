/**
 * `ReviewIngestService` (review-reorient Phase 3) — the vertical slice that turns
 * a pasted PR URL (+ optional Jira ticket) into a stored {@link ReviewReport}.
 *
 * This is the pivot: instead of the harness *authoring* code (the retired
 * `AgentRunner` + `ShellGitAdapter.applyAndCommit` path), it *reads* an external
 * pull request, asks the AI to review it against the requirement, and persists
 * the report + findings + fix suggestions for the web UI.
 *
 * The orchestrator's canonical task machine is **not** driving this review. A
 * task is still created (so the report joins the provenance trail and the
 * integration events carry a real `task_id`), but it is immediately CANCELLED so
 * the Day-08 `Dispatcher` — which pulls `PENDING`/`REWORK` tasks into the
 * retired code-gen workflow — never touches it.
 *
 * The heavy lifting lives in focused stage modules under `review-ingest/`:
 * URL parsing (`pr-url.ts`), diff assembly (`diff-builder.ts`), the LLM
 * pipeline (`review-pipeline.ts`), persistence (`persistence.ts`), failure
 * reporting (`review-failure-reporter.ts`), retries (`retry.ts`) and the
 * shared error classes (`errors.ts`). This file is the slim orchestrator that
 * composes them.
 */

import { eq } from 'drizzle-orm';

import { brand, EventType, newReviewReportID, TaskStatus } from '@harness/domain';
import type { AiProviderType, Issue, MemoryProvider, PullRequest, ReviewReportID, TaskID } from '@harness/domain';
import type {
  IntegrationPrFetchedPayload,
  IntegrationTicketFetchedPayload,
  ReviewReportCreatedPayload,
} from '@harness/domain';
import { reviewReports } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';
import type { GitProvider } from '@harness/git-provider';
import type { TicketProvider } from '@harness/ticket-provider';
import type { TaskService } from '@harness/orchestrator';
import type { ReviewAgent } from '@harness/agent-runtime';

import { DecisionInsertError, ReviewIngestError } from './review-ingest/errors.js';
import { parseGithubPrUrl } from './review-ingest/pr-url.js';
import { buildDiff } from './review-ingest/diff-builder.js';
import {
  getOrCreateProject,
  insertBatchFindingsAndSuggestions,
  insertCompletedReport,
  insertPlaceholderReport,
  markReportComplete,
  resolveReportTaskId,
  updateReportStatus,
} from './review-ingest/persistence.js';
import {
  buildPipelineOptions,
  mapProviderErrorToIngestError,
  recallMemories,
  runReviewPipeline,
} from './review-ingest/review-pipeline.js';
import { handleReviewProcessingFailure } from './review-ingest/review-failure-reporter.js';

export { DecisionInsertError, ReviewIngestError };
export { parseGithubPrUrl, buildDiff };

/** The raw request body the route hands to the service. */
export interface ReviewIngestInput {
  readonly prUrl: string;
  /** Jira issue key, e.g. `ACME-1234`. Optional. */
  readonly jiraTicket?: string;
  /**
   * When true, the reviewer operates in full code-review mode (all severities).
   * Defaults to false (human-review mode, only CRITICAL/MAJOR).
   */
  readonly autoReviewMode?: boolean;
}

/** What the route returns after a successful ingest. */
export interface ReviewIngestResult {
  readonly reportId: ReviewReportID;
  readonly taskId: TaskID;
  readonly prUrl: string;
  readonly overallVerdict: string;
  readonly findingCount: number;
  readonly suggestionCount: number;
}

export interface ReviewIngestDeps {
  readonly db: DrizzleDB;
  readonly bus: IEventBus;
  readonly taskService: TaskService;
  /** Null when no Git token is configured — `ingest` then fails with a clear 503. */
  readonly gitProvider: GitProvider | null;
  /** Null when no Jira provider is configured — a jiraTicket then fails fast. */
  readonly ticketProvider: TicketProvider | null;
  readonly reviewAgent: ReviewAgent;
  /** The AI vendor + model used, stamped onto the report for provenance. */
  readonly aiProvider: AiProviderType;
  readonly model: string;
  readonly logger: Logger;
  /** Optional memory provider for past review context retrieval. */
  readonly memoryProvider?: MemoryProvider;
  /** Max files per batch (default 5). */
  readonly maxBatchSize?: number;
  /** Max tokens per batch (default 8000). */
  readonly maxBatchTokens?: number;
  /** Enable two-pass review: summarize first, then deep-review only high/medium risk files. */
  readonly twoPassEnabled?: boolean;
  /** Max concurrent AI requests (default 3). */
  readonly maxConcurrency?: number;
  /** When true, review in full code-review mode (all severities). */
  readonly autoReviewMode?: boolean;
}

export class ReviewIngestService {
  constructor(private readonly deps: ReviewIngestDeps) {}

  /**
   * Guard + fetch shared by both entry points: fail fast with a 503 when no
   * Git provider is configured, parse the pasted URL, and pull the PR.
   */
  private async fetchPr(prUrl: string) {
    const { gitProvider } = this.deps;
    if (!gitProvider) {
      throw new ReviewIngestError('no Git provider configured (set GITHUB_TOKEN)', 503);
    }
    const { repo, number } = parseGithubPrUrl(prUrl);
    const pr = await gitProvider.fetchPullRequest({ repo, number });
    return { repo, pr };
  }

  /**
   * Shared pre-flight for both entry points: create a real task to anchor the
   * trail and immediately cancel it (so the retired code-gen dispatcher, which
   * pulls PENDING/REWORK, never consumes it), then publish the
   * `IntegrationPrFetched` event.
   */
  private async createCancelledTask(repo: string, pr: PullRequest, prUrl: string) {
    const { db, bus, taskService } = this.deps;

    const projectId = await getOrCreateProject(db, repo);
    const task = await taskService.createTask({
      projectId,
      title: `Review: ${pr.title}`,
      description: prUrl,
    });
    await taskService.transitionTask(task.id, TaskStatus.Cancelled, 'human', {
      rationale: 'review-only task handled by the review slice (no orchestrator workflow)',
    });
    const correlationId = brand(task.id, 'CorrelationID');

    const prFetched: IntegrationPrFetchedPayload = {
      task_id: task.id,
      provider: pr.provider,
      repo,
      pr_number: pr.number,
      pr_url: pr.url,
      file_count: pr.files.length,
    };
    bus.publish(createEvent(EventType.IntegrationPrFetched, correlationId, prFetched));

    return { taskId: task.id, correlationId };
  }

  /**
   * Create a review report with placeholder data and return immediately.
   * The actual AI review runs asynchronously via {@link processReview}.
   *
   * Returns the report id and task id so the HTTP response can return 202
   * with a location the frontend can poll.
   */
  async createReview(input: ReviewIngestInput): Promise<{
    reportId: ReviewReportID;
    taskId: TaskID;
    prUrl: string;
  }> {
    const { db, aiProvider, model, logger } = this.deps;

    const { repo, pr } = await this.fetchPr(input.prUrl);
    const { taskId } = await this.createCancelledTask(repo, pr, input.prUrl);

    // Create the report row with placeholder data so the frontend can poll it.
    const reportId = newReviewReportID();
    await insertPlaceholderReport(db, {
      reportId,
      taskId,
      pr,
      repo,
      aiProvider,
      model,
    });

    logger.info('review report created (pending)', {
      report_id: reportId,
      pr_url: pr.url,
      task_id: taskId,
    });

    return { reportId, taskId, prUrl: pr.url };
  }

  /**
   * Synchronous ingest — create task, fetch PR, call AI, save report.
   * Used by tests and the legacy path. For async production use, call
   * {@link createReview} then {@link processReview} separately.
   */
  async ingest(input: ReviewIngestInput): Promise<ReviewIngestResult> {
    const { db, bus, ticketProvider, aiProvider, model, logger } = this.deps;

    const { repo, pr } = await this.fetchPr(input.prUrl);

    // A real task anchors the trail; cancel it immediately so the retired
    // code-gen dispatcher (which pulls PENDING/REWORK) never consumes it.
    const { taskId, correlationId } = await this.createCancelledTask(repo, pr, input.prUrl);

    let requirement = '';
    if (input.jiraTicket !== undefined) {
      if (!ticketProvider) {
        throw new ReviewIngestError('jiraTicket provided but no ticket provider is configured', 400);
      }
      const issue: Issue = await ticketProvider.fetchIssue({ key: input.jiraTicket });
      requirement = `${issue.summary}\n${issue.description}`;
      const ticketFetched: IntegrationTicketFetchedPayload = {
        task_id: taskId,
        provider: issue.provider,
        issue_key: issue.key,
      };
      bus.publish(createEvent(EventType.IntegrationTicketFetched, correlationId, ticketFetched));
    }

    const agentOutput = await runReviewPipeline(
      this.deps,
      pr.files,
      await buildPipelineOptions(this.deps, pr.url, pr.title, requirement, taskId, input.autoReviewMode),
    ).catch((error: unknown) => {
      // An AI-provider failure (timeout, network drop, or a non-2xx from the
      // OpenAI-compatible endpoint) is an upstream problem, not a 500 — map it
      // onto a review-ingest error with a status the create screen can read.
      const mapped = mapProviderErrorToIngestError(error);
      if (mapped !== undefined) throw mapped;
      throw error;
    });

    const reportId = newReviewReportID();
    await insertCompletedReport(db, {
      reportId,
      taskId,
      pr,
      repo,
      aiProvider,
      model,
      agentOutput,
    });

    // Batch insert findings + suggestions in two queries instead of N+1 round-trips.
    await insertBatchFindingsAndSuggestions(db, reportId, agentOutput, {
      findingOffset: 0,
      suggestionOffset: 0,
    });

    const reportCreated: ReviewReportCreatedPayload = {
      task_id: taskId,
      review_report_id: reportId,
      pr_url: pr.url,
      finding_count: agentOutput.findings.length,
      suggestion_count: agentOutput.suggestions.length,
    };
    bus.publish(createEvent(EventType.ReviewReportCreated, correlationId, reportCreated));

    logger.info('review report created', { report_id: reportId, pr_url: pr.url, task_id: taskId });

    return {
      reportId,
      taskId,
      prUrl: pr.url,
      overallVerdict: agentOutput.overallVerdict,
      findingCount: agentOutput.findings.length,
      suggestionCount: agentOutput.suggestions.length,
    };
  }

  /**
   * Process a review asynchronously — the slow part (AI call) that runs in the
   * background worker. Fetches the PR, runs the review pipeline, and updates
   * the report row with findings + suggestions.
   *
   * Designed to be called from a background worker (event subscriber).
   * Updates `review_status` at each stage so the frontend can show progress.
   */
  async processReview(
    reportId: ReviewReportID,
    input: {
      prUrl: string;
      jiraTicket?: string;
      autoReviewMode?: boolean;
    },
  ): Promise<void> {
    const { db, bus, gitProvider, ticketProvider, logger } = this.deps;

    if (!gitProvider) {
      logger.error('review processing failed: no git provider configured', { report_id: reportId });
      await updateReportStatus(db, logger, reportId, 'status error', {
        review_status: 'error',
        summary: '❌ Review failed: no Git provider configured',
        completed_at: new Date(),
      }).catch(() => {});
      return;
    }

    try {
      // Stage: fetching — retrieve PR from GitHub.
      await updateReportStatus(db, logger, reportId, 'status fetching', {
        review_status: 'fetching',
      });

      const { repo, number } = parseGithubPrUrl(input.prUrl);
      const pr = await gitProvider.fetchPullRequest({ repo, number });
      // Persist the freshly-fetched payload so the Diff tab never stays stuck
      // on a stale headers-only patch from `createReview` (e.g. Bitbucket
      // Server `RestDiffLine` objects the old parser dropped → `@@` only,
      // +0/−0). Retry then heals existing reports without re-creating them.
      await updateReportStatus(db, logger, reportId, 'store refreshed pr_payload', {
        pr_payload: pr,
      });

      let requirement = '';
      if (input.jiraTicket !== undefined && ticketProvider) {
        const issue: Issue = await ticketProvider.fetchIssue({ key: input.jiraTicket });
        requirement = `${issue.summary}\n${issue.description}`;
      }

      // Stage: recalling — retrieve past review context.
      // Do memory recall first so we can store the results.
      const recalledMemories = await recallMemories(this.deps.memoryProvider, pr.title, requirement);

      await updateReportStatus(db, logger, reportId, 'status recalling', {
        review_status: 'recalling',
        recalled_memories: recalledMemories,
      });

      // Track how many findings have been inserted so far for `order_index`.
      const offsets = { findingOffset: 0, suggestionOffset: 0 };

      // Stage: reviewing — run the AI pipeline with a per-batch callback that
      // inserts findings progressively and updates batch_progress.
      await updateReportStatus(db, logger, reportId, 'status reviewing', {
        review_status: 'reviewing',
        batch_progress: { current: 0, total: 0 },
      });

      const agentOutput = await runReviewPipeline(
        this.deps,
        pr.files,
        await buildPipelineOptions(this.deps, pr.url, pr.title, requirement, reportId, input.autoReviewMode),
        // Per-batch callback: insert findings + suggestions immediately, update progress.
        async (batchIndex: number, batchCount: number, output) => {
          // Batch insert this batch's findings + suggestions.
          await insertBatchFindingsAndSuggestions(db, reportId, output, offsets);
          // Update batch progress.
          await db
            .update(reviewReports)
            .set({
              batch_progress: { current: batchIndex + 1, total: batchCount },
            })
            .where(eq(reviewReports.id, reportId));
        },
      );

      // Stage: storing — finalise the report with merged summary + verdict.
      await updateReportStatus(db, logger, reportId, 'status storing', {
        review_status: 'storing',
      });

      await markReportComplete(db, logger, reportId, agentOutput, pr.files);

      const reportCreated: ReviewReportCreatedPayload = {
        task_id: await resolveReportTaskId(db, reportId),
        review_report_id: reportId,
        pr_url: pr.url,
        finding_count: offsets.findingOffset,
        suggestion_count: offsets.suggestionOffset,
      };
      bus.publish(createEvent(EventType.ReviewReportCreated, brand(reportId, 'CorrelationID'), reportCreated));

      logger.info('review report processed (async)', { report_id: reportId, pr_url: pr.url });
    } catch (error) {
      await handleReviewProcessingFailure(db, logger, reportId, error);
    }
  }
}
