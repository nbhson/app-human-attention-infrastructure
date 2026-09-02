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
 */

import { eq } from 'drizzle-orm';

import { isReviewableFile } from '../review-file-classify.js';
import { redactSensitivePatch } from '../review-secret-redact.js';
import { envInt } from '../env-utils.js';

import { OpenAICompatibleError, ReviewParseError } from '@harness/agent-runtime';
import { batchReview, budgetFiles } from '@harness/agent-runtime';
import type { BatchReviewOptions, ReviewAgent, ReviewAgentOutput } from '@harness/agent-runtime';
import {
  brand,
  EventType,
  FindingKind,
  newFixSuggestionID,
  newProjectID,
  newReviewFindingID,
  newReviewReportID,
  TaskStatus,
} from '@harness/domain';
import type {
  AiProviderType,
  Issue,
  MemoryProvider,
  ProjectID,
  PullRequestFile,
  ReviewReportID,
  TaskID,
} from '@harness/domain';
import type {
  IntegrationPrFetchedPayload,
  IntegrationTicketFetchedPayload,
  ReviewReportCreatedPayload,
} from '@harness/domain';
import { fixSuggestions, projects, reviewFindings, reviewReports } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';
import type { GitProvider } from '@harness/git-provider';
import type { TicketProvider } from '@harness/ticket-provider';
import type { TaskService } from '@harness/orchestrator';

/**
 * Retry a transient operation with exponential back-off (up to `maxAttempts`
 * tries). DB deadlocks, connection drops, and lock timeouts are considered
 * transient; business errors (not-found, validation) are not retried.
 */
async function retryTransient<T>(
  label: string,
  fn: () => Promise<T>,
  logger: Logger,
  reportId: string,
  maxAttempts = 3,
  baseMs = 200,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isTransient =
        error instanceof Error && /deadlock|lock timeout|connection|ECONNRESET|ETIMEDOUT/i.test(error.message);
      if (!isTransient || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = baseMs * 2 ** (attempt - 1);
      logger.warn(`${label} transient failure, retrying`, {
        report_id: reportId,
        attempt,
        maxAttempts,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable — the loop always either returns or throws.
  throw new Error(`${label} retry exhausted`);
}

/** A review-request failed for a user-correctable reason (bad URL, missing provider). */
export class ReviewIngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ReviewIngestError';
  }
}

/** The raw request body the route hands to the service. */
export interface ReviewIngestInput {
  readonly prUrl: string;
  /** Jira issue key, e.g. `ACME-1234`. Optional. */
  readonly jiraTicket?: string;
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

/**
 * Parse a GitHub PR web URL into the `host/owner/name` repo slug + PR number the
 * {@link GitProvider} seam expects. GitLab/Bitbucket reach here once their
 * providers exist (Phase 3); today a non-GitHub URL is a clear 400.
 */
export function parseGithubPrUrl(prUrl: string): { repo: string; number: number } {
  let url: URL;
  try {
    url = new URL(prUrl);
  } catch {
    throw new ReviewIngestError(`"${prUrl}" is not a valid URL`, 400);
  }
  const parts = url.pathname.split('/').filter(Boolean);
  // github.com/owner/name/pull/123
  if (parts.length >= 4 && parts[2] === 'pull') {
    const number = Number(parts[3]);
    if (!Number.isInteger(number)) {
      throw new ReviewIngestError(`"${prUrl}" has no PR number`, 400);
    }
    return { repo: `${url.host}/${parts[0]}/${parts[1]}`, number };
  }
  throw new ReviewIngestError(`only GitHub pull-request URLs are supported today, got "${prUrl}"`, 400);
}

/**
 * Concatenate a PR's per-file patches into one diff block. Every hand-written
 * file is kept — source, docs (README), config and infra (Dockerfile, YAML,
 * JSON, env, …) alike; only generated artifacts ({@link isGeneratedFile}) and
 * empty/binary patches are dropped (see {@link isReviewableFile}). Secret values
 * on `.env` / Compose files are masked (see {@link redactSensitivePatch}) so a
 * live credential never reaches the LLM prompt. The AI reviews the *whole*
 * change, not just the code.
 */
export function buildDiff(files: readonly PullRequestFile[]): string {
  return files
    .filter((f) => isReviewableFile(f.path) && f.patch.trim().length > 0)
    .map(
      (f) =>
        `=== ${f.path} (${f.status}, +${f.additions} -${f.deletions}) ===\n` + redactSensitivePatch(f.path, f.patch),
    )
    .join('\n\n');
}

/** Get-or-create the owning project by repo slug (same idempotent pattern as the task route). */
async function getOrCreateProject(db: DrizzleDB, repo: string): Promise<ProjectID> {
  const rows = await db.select({ id: projects.id }).from(projects).where(eq(projects.repo_path, repo)).limit(1);
  const existing = rows[0];
  if (existing) {
    return brand(existing.id, 'ProjectID');
  }
  const id = newProjectID();
  await db.insert(projects).values({ id, name: repo, repo_path: repo });
  return id;
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
}

export class ReviewIngestService {
  constructor(private readonly deps: ReviewIngestDeps) {}

  /**
   * Synchronous ingest — create task, fetch PR, call AI, save report.
   * Used by tests and the legacy path. For async production use, call
   * {@link createReview} then {@link processReview} separately.
   */
  async ingest(input: ReviewIngestInput): Promise<ReviewIngestResult> {
    const { gitProvider } = this.deps;
    const { db, bus, taskService, ticketProvider, aiProvider, model, logger } = this.deps;

    if (!gitProvider) {
      throw new ReviewIngestError('no Git provider configured (set GITHUB_TOKEN)', 503);
    }

    const { repo, number } = parseGithubPrUrl(input.prUrl);
    const pr = await gitProvider.fetchPullRequest({ repo, number });

    // A real task anchors the trail; cancel it immediately so the retired
    // code-gen dispatcher (which pulls PENDING/REWORK) never consumes it.
    const projectId = await getOrCreateProject(db, repo);
    const task = await taskService.createTask({
      projectId,
      title: `Review: ${pr.title}`,
      description: input.prUrl,
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

    let requirement = '';
    if (input.jiraTicket !== undefined) {
      if (!ticketProvider) {
        throw new ReviewIngestError('jiraTicket provided but no ticket provider is configured', 400);
      }
      const issue: Issue = await ticketProvider.fetchIssue({ key: input.jiraTicket });
      requirement = `${issue.summary}\n${issue.description}`;
      const ticketFetched: IntegrationTicketFetchedPayload = {
        task_id: task.id,
        provider: issue.provider,
        issue_key: issue.key,
      };
      bus.publish(createEvent(EventType.IntegrationTicketFetched, correlationId, ticketFetched));
    }

    const agentOutput = await this.reviewWithPipeline(
      pr.files,
      {
        prUrl: pr.url,
        prTitle: pr.title,
        requirement,
        model,
        correlationId: task.id,
        maxAgentTokens: envInt('AI_MAX_TOKENS', 32_000),
      },
      correlationId,
    ).catch((error: unknown) => {
      // An AI-provider failure (timeout, network drop, or a non-2xx from the
      // OpenAI-compatible endpoint) is an upstream problem, not a 500. Surface
      // it as a review-ingest error with a status the create screen can map —
      // so a hung "deepseek" model reads "timed out", never a bare Internal
      // Server Error.
      if (error instanceof OpenAICompatibleError) {
        const isTimeout = error.kind === 'timeout';
        throw new ReviewIngestError(
          isTimeout
            ? `the AI provider did not respond in time — ${error.message}`
            : `the AI provider failed — ${error.message}`,
          isTimeout ? 504 : 502,
        );
      }
      // A reasoning model whose output budget was exhausted returns truncated
      // JSON; parsing it fails with a ReviewParseError. That is still an
      // upstream/AI problem (retry-able, not a code defect), so surface it as
      // a 502 rather than leaking an unhelpful 500.
      if (error instanceof ReviewParseError) {
        throw new ReviewIngestError(`the AI returned an unusable review (${error.message}) — try again`, 502);
      }
      throw error;
    });

    const reportId = newReviewReportID();
    await db.insert(reviewReports).values({
      id: reportId,
      task_id: task.id,
      correlation_id: task.id,
      pr_url: pr.url,
      pr_number: pr.number,
      repo,
      pr_title: pr.title,
      ai_provider: aiProvider,
      model,
      summary: agentOutput.summary,
      overall_verdict: agentOutput.overallVerdict,
      pr_payload: pr,
    });

    // Batch insert findings + suggestions in two queries instead of N+1 round-trips.
    const findingRows = agentOutput.findings.map((finding, index) => ({
      id: newReviewFindingID(),
      report_id: reportId,
      severity: finding.severity,
      kind: finding.kind ?? FindingKind.Correctness,
      file: finding.file,
      line: finding.line ?? null,
      message: finding.message,
      suggestion: finding.suggestion ?? null,
      order_index: index,
    }));
    const suggestionRows = agentOutput.suggestions.map((suggestion, index) => ({
      id: newFixSuggestionID(),
      report_id: reportId,
      file: suggestion.file,
      hunk: suggestion.hunk ?? null,
      proposed: suggestion.proposed,
      rationale: suggestion.rationale,
      order_index: index,
    }));
    if (findingRows.length > 0) {
      await db.insert(reviewFindings).values(findingRows);
    }
    if (suggestionRows.length > 0) {
      await db.insert(fixSuggestions).values(suggestionRows);
    }

    const reportCreated: ReviewReportCreatedPayload = {
      task_id: task.id,
      review_report_id: reportId,
      pr_url: pr.url,
      finding_count: agentOutput.findings.length,
      suggestion_count: agentOutput.suggestions.length,
    };
    bus.publish(createEvent(EventType.ReviewReportCreated, correlationId, reportCreated));

    logger.info('review report created', { report_id: reportId, pr_url: pr.url, task_id: task.id });

    return {
      reportId,
      taskId: task.id,
      prUrl: pr.url,
      overallVerdict: agentOutput.overallVerdict,
      findingCount: agentOutput.findings.length,
      suggestionCount: agentOutput.suggestions.length,
    };
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
    const { db, bus, taskService, gitProvider, aiProvider, model, logger } = this.deps;

    if (!gitProvider) {
      throw new ReviewIngestError('no Git provider configured (set GITHUB_TOKEN)', 503);
    }

    const { repo, number } = parseGithubPrUrl(input.prUrl);
    const pr = await gitProvider.fetchPullRequest({ repo, number });

    const projectId = await getOrCreateProject(db, repo);
    const task = await taskService.createTask({
      projectId,
      title: `Review: ${pr.title}`,
      description: input.prUrl,
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

    // Create the report row with placeholder data so the frontend can poll it.
    const reportId = newReviewReportID();
    const placeholderSummary = '⏳ Review is being processed...';
    await db.insert(reviewReports).values({
      id: reportId,
      task_id: task.id,
      correlation_id: task.id,
      pr_url: pr.url,
      pr_number: pr.number,
      repo,
      pr_title: pr.title,
      ai_provider: aiProvider,
      model,
      summary: placeholderSummary,
      overall_verdict: 'COMMENT' as const,
      pr_payload: pr,
    });

    logger.info('review report created (pending)', {
      report_id: reportId,
      pr_url: pr.url,
      task_id: task.id,
    });

    return { reportId, taskId: task.id, prUrl: pr.url };
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
    },
  ): Promise<void> {
    const { db, bus, gitProvider, ticketProvider, model, logger } = this.deps;

    if (!gitProvider) {
      logger.error('review processing failed: no git provider configured', { report_id: reportId });
      await retryTransient(
        'status error',
        () =>
          db
            .update(reviewReports)
            .set({
              review_status: 'error',
              summary: '❌ Review failed: no Git provider configured',
            })
            .where(eq(reviewReports.id, reportId)),
        logger,
        reportId,
      ).catch(() => {});
      return;
    }

    try {
      // Stage: fetching — retrieve PR from GitHub.
      await retryTransient(
        'status fetching',
        () => db.update(reviewReports).set({ review_status: 'fetching' }).where(eq(reviewReports.id, reportId)),
        logger,
        reportId,
      );

      const { repo, number } = parseGithubPrUrl(input.prUrl);
      const pr = await gitProvider.fetchPullRequest({ repo, number });

      let requirement = '';
      if (input.jiraTicket !== undefined && ticketProvider) {
        const issue: Issue = await ticketProvider.fetchIssue({ key: input.jiraTicket });
        requirement = `${issue.summary}\n${issue.description}`;
      }

      // Stage: recalling — retrieve past review context.
      await retryTransient(
        'status recalling',
        () => db.update(reviewReports).set({ review_status: 'recalling' }).where(eq(reviewReports.id, reportId)),
        logger,
        reportId,
      );

      // Track how many findings have been inserted so far for `order_index`.
      let findingOffset = 0;
      let suggestionOffset = 0;

      // Stage: reviewing — run the AI pipeline with a per-batch callback that
      // inserts findings progressively and updates batch_progress.
      await retryTransient(
        'status reviewing',
        () =>
          db
            .update(reviewReports)
            .set({
              review_status: 'reviewing',
              batch_progress: { current: 0, total: 0 },
            })
            .where(eq(reviewReports.id, reportId)),
        logger,
        reportId,
      );

      const agentOutput = await this.reviewWithPipeline(
        pr.files,
        {
          prUrl: pr.url,
          prTitle: pr.title,
          requirement,
          model,
          correlationId: reportId,
          maxAgentTokens: envInt('AI_MAX_TOKENS', 32_000),
        },
        brand(reportId, 'CorrelationID'),
        // Per-batch callback: insert findings + suggestions immediately, update progress.
        async (batchIndex: number, batchCount: number, output) => {
          // Batch insert this batch's findings + suggestions.
          const batchFindings = output.findings.map((finding) => ({
            id: newReviewFindingID(),
            report_id: reportId,
            severity: finding.severity,
            kind: finding.kind ?? FindingKind.Correctness,
            file: finding.file,
            line: finding.line ?? null,
            message: finding.message,
            suggestion: finding.suggestion ?? null,
            order_index: findingOffset++,
          }));
          const batchSuggestions = output.suggestions.map((suggestion) => ({
            id: newFixSuggestionID(),
            report_id: reportId,
            file: suggestion.file,
            hunk: suggestion.hunk ?? null,
            proposed: suggestion.proposed,
            rationale: suggestion.rationale,
            order_index: suggestionOffset++,
          }));
          if (batchFindings.length > 0) {
            await db.insert(reviewFindings).values(batchFindings);
          }
          if (batchSuggestions.length > 0) {
            await db.insert(fixSuggestions).values(batchSuggestions);
          }
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
      await retryTransient(
        'status storing',
        () => db.update(reviewReports).set({ review_status: 'storing' }).where(eq(reviewReports.id, reportId)),
        logger,
        reportId,
      );

      await retryTransient(
        'status complete',
        () =>
          db
            .update(reviewReports)
            .set({
              summary: agentOutput.summary,
              overall_verdict: agentOutput.overallVerdict,
              review_status: 'complete',
              batch_progress: null,
            })
            .where(eq(reviewReports.id, reportId)),
        logger,
        reportId,
      );

      const reportCreated: ReviewReportCreatedPayload = {
        task_id: brand(reportId, 'TaskID'),
        review_report_id: reportId,
        pr_url: pr.url,
        finding_count: findingOffset,
        suggestion_count: suggestionOffset,
      };
      bus.publish(createEvent(EventType.ReviewReportCreated, brand(reportId, 'CorrelationID'), reportCreated));

      logger.info('review report processed (async)', { report_id: reportId, pr_url: pr.url });
    } catch (error) {
      logger.error('review processing failed', { report_id: reportId, error: String(error) });
      await retryTransient(
        'status error fallback',
        () =>
          db
            .update(reviewReports)
            .set({
              review_status: 'error',
              summary: `❌ Review failed: ${error instanceof Error ? error.message : String(error)}`,
              overall_verdict: 'COMMENT' as const,
            })
            .where(eq(reviewReports.id, reportId)),
        logger,
        reportId,
      ).catch(() => {}); // Swallow DB error on the error-path.
    }
  }

  /**
   * Run the full review pipeline: memory recall → file budgeting → batch review
   * (optionally two-pass). When `twoPassEnabled` is true, a lightweight summary
   * pass runs first to identify high/medium risk files, then only those files
   * are deep-reviewed.
   *
   * When `onBatch` is provided, it is called after each batch completes so the
   * caller can progressively store findings (progressive findings).
   */
  private async reviewWithPipeline(
    files: readonly PullRequestFile[],
    opts: {
      prUrl: string;
      prTitle: string;
      requirement: string;
      model: string;
      correlationId: string;
      maxAgentTokens?: number;
    },
    _correlationId: string,
    onBatch?: (batchIndex: number, batchCount: number, output: ReviewAgentOutput) => Promise<void>,
  ) {
    const { reviewAgent, memoryProvider, twoPassEnabled, maxBatchSize, maxBatchTokens, maxConcurrency } = this.deps;

    // 1. Memory recall: retrieve past review findings relevant to this PR.
    const rawMemories = memoryProvider
      ? await memoryProvider.retrieve({
          text: `${opts.prTitle} ${opts.requirement}`,
          limit: 5,
        })
      : undefined;

    // Map MemoryRetrievalResult → ReviewPromptInput['relatedMemories'] shape.
    const relatedMemories = rawMemories
      ? rawMemories.map((m) => ({
          kind: m.entry.kind,
          content: m.entry.content,
          confidence: m.entry.confidence,
          metadata: m.entry.metadata,
        }))
      : undefined;

    // 2. Filter reviewable files and build the diff for token estimation.
    const reviewable = files.filter((f) => isReviewableFile(f.path) && f.patch.trim().length > 0);
    if (reviewable.length === 0) {
      return { summary: '', overallVerdict: 'COMMENT' as const, findings: [], suggestions: [] };
    }

    // 3. Two-pass: summarise first, then only deep-review high/medium risk files.
    //    For large PRs (50+ files) the summary pass would send ALL diff content
    //    in a single AI call, which is extremely slow with reasoning models. Skip
    //    two-pass and rely on keyword-based budgeting instead.
    const TWO_PASS_FILE_LIMIT = 50;
    const twoPassEffective = twoPassEnabled && reviewable.length <= TWO_PASS_FILE_LIMIT;
    let targetFiles: readonly PullRequestFile[] = reviewable;
    if (twoPassEffective) {
      const summaryDiff = buildDiff(reviewable);
      const fileSummaries = await reviewAgent.summarizeFiles(
        {
          prUrl: opts.prUrl,
          prTitle: opts.prTitle,
          requirement: opts.requirement,
          diff: summaryDiff,
        },
        {
          model: opts.model,
          correlationId: opts.correlationId,
          ...(opts.maxAgentTokens !== undefined ? { maxTokens: opts.maxAgentTokens } : {}),
        } as Parameters<typeof reviewAgent.summarizeFiles>[1],
      );
      const highRiskFiles = new Set(
        fileSummaries.filter((s) => s.risk === 'high' || s.risk === 'medium').map((s) => s.file),
      );
      if (highRiskFiles.size > 0) {
        targetFiles = reviewable.filter((f) => highRiskFiles.has(f.path));
      }
      // If two-pass yields nothing high/medium, fall back to the first batch.
      if (targetFiles.length === 0) {
        targetFiles = reviewable.slice(0, maxBatchSize ?? 5);
      }
    }

    // 4. Context-aware file budgeting: rank by keyword relevance from PR title + requirement.
    const keywords = [
      ...opts.prTitle.split(/\s+/).filter((w) => w.length > 2),
      ...opts.requirement.split(/\s+/).filter((w) => w.length > 2),
    ];
    // Remove duplicates while preserving order.
    const uniqueKeywords = [...new Set(keywords)];
    const budgeted = budgetFiles(targetFiles, {
      keywords: uniqueKeywords.length > 0 ? uniqueKeywords : ['review'],
      maxTokens: maxBatchTokens ?? 8000,
      maxSources: maxBatchSize ?? 5,
    });

    // If budgeted primary is empty, use the first batch-worth of files.
    const filesToReview = budgeted.primary.length > 0 ? budgeted.primary : targetFiles.slice(0, maxBatchSize ?? 5);

    // 5. Batch review (parallel), with progressive callback if provided.
    return batchReview(
      reviewAgent,
      filesToReview,
      {
        prUrl: opts.prUrl,
        prTitle: opts.prTitle,
        requirement: opts.requirement,
        model: opts.model,
        correlationId: opts.correlationId,
        maxBatchSize: maxBatchSize ?? 5,
        maxBatchTokens: maxBatchTokens ?? 8000,
        maxConcurrency: maxConcurrency ?? 10,
        ...(opts.maxAgentTokens !== undefined ? { maxAgentTokens: opts.maxAgentTokens } : {}),
        ...(relatedMemories !== undefined && relatedMemories.length > 0 ? { relatedMemories } : {}),
      } as unknown as BatchReviewOptions,
      onBatch,
    );
  }
}
