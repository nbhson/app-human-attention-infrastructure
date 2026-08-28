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

import { OpenAICompatibleError, ReviewParseError } from '@harness/agent-runtime';
import type { ReviewAgent } from '@harness/agent-runtime';
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
  throw new ReviewIngestError(
    `only GitHub pull-request URLs are supported today, got "${prUrl}"`,
    400,
  );
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
        `=== ${f.path} (${f.status}, +${f.additions} -${f.deletions}) ===\n` +
        redactSensitivePatch(f.path, f.patch),
    )
    .join('\n\n');
}

/** Get-or-create the owning project by repo slug (same idempotent pattern as the task route). */
async function getOrCreateProject(db: DrizzleDB, repo: string): Promise<ProjectID> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.repo_path, repo))
    .limit(1);
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
}

export class ReviewIngestService {
  constructor(private readonly deps: ReviewIngestDeps) {}

  async ingest(input: ReviewIngestInput): Promise<ReviewIngestResult> {
    const {
      db,
      bus,
      taskService,
      gitProvider,
      ticketProvider,
      reviewAgent,
      aiProvider,
      model,
      logger,
    } = this.deps;

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
        throw new ReviewIngestError(
          'jiraTicket provided but no ticket provider is configured',
          400,
        );
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

    const agentOutput = await reviewAgent
      .review(
        {
          prUrl: pr.url,
          prTitle: pr.title,
          requirement,
          diff: buildDiff(pr.files),
        },
        { model, correlationId: task.id },
      )
      .catch((error: unknown) => {
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
          throw new ReviewIngestError(
            `the AI returned an unusable review (${error.message}) — try again`,
            502,
          );
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

    for (const [index, finding] of agentOutput.findings.entries()) {
      await db.insert(reviewFindings).values({
        id: newReviewFindingID(),
        report_id: reportId,
        severity: finding.severity,
        kind: finding.kind ?? FindingKind.Correctness,
        file: finding.file,
        line: finding.line ?? null,
        message: finding.message,
        suggestion: finding.suggestion ?? null,
        order_index: index,
      });
    }
    for (const [index, suggestion] of agentOutput.suggestions.entries()) {
      await db.insert(fixSuggestions).values({
        id: newFixSuggestionID(),
        report_id: reportId,
        file: suggestion.file,
        hunk: suggestion.hunk ?? null,
        proposed: suggestion.proposed,
        rationale: suggestion.rationale,
        order_index: index,
      });
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
}
