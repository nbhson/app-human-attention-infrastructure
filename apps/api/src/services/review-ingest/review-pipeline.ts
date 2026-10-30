/**
 * LLM review pipeline stage for the review-ingest slice: memory recall → file
 * budgeting → batch review (optionally two-pass), plus the triage-rule
 * resolvers (operator instructions, reasoning effort) and the AI-provider
 * error → {@link ReviewIngestError} mapping the route layer surfaces.
 */

import { AnthropicError, OpenAICompatibleError, ReviewParseError } from '@harness/agent-runtime';
import { batchReview, budgetFiles, buildImpactScope } from '@harness/agent-runtime';
import type { BatchReviewOptions, ReviewAgent, ReviewAgentOutput } from '@harness/agent-runtime';

import { isReviewableFile } from '../../review-file-classify.js';
import { envInt } from '../../env-utils.js';
import { loadTriageRuleState } from '../../triage-rules-store.js';
import { ReviewIngestError } from './errors.js';
import { buildDiff } from './diff-builder.js';

import type { PullRequestFile } from '@harness/domain';
import type { DrizzleDB } from '@harness/db';
import type { Logger } from '@harness/di';
import type { MemoryProvider } from '@harness/domain';

/** Inputs the pipeline needs beyond the PR files. */
export interface ReviewPipelineOptions {
  prUrl: string;
  prTitle: string;
  requirement: string;
  model: string;
  correlationId: string;
  maxAgentTokens?: number;
  autoReviewMode?: boolean;
  /** Operator instructions / skill text ("text.md") to inject into the prompt. */
  instructions?: string;
}

/** The slice of {@link import('./review-ingest.js').ReviewIngestDeps} the pipeline reads. */
export interface ReviewPipelineDeps {
  readonly db: DrizzleDB;
  readonly reviewAgent: ReviewAgent;
  readonly logger: Logger;
  readonly memoryProvider?: MemoryProvider;
  readonly maxBatchSize?: number;
  readonly maxBatchTokens?: number;
  readonly twoPassEnabled?: boolean;
  readonly maxConcurrency?: number;
}

/**
 * Map an AI-provider failure onto a {@link ReviewIngestError} with a status the
 * create screen can map — so a hung "deepseek" model reads "timed out", never a
 * bare Internal Server Error. Returns `undefined` when the error is not a
 * provider/parse failure and should be rethrown untouched.
 */
export function mapProviderErrorToIngestError(error: unknown): ReviewIngestError | undefined {
  // An AI-provider failure (timeout, network drop, or a non-2xx from the
  // OpenAI-compatible endpoint) is an upstream problem, not a 500.
  if (error instanceof OpenAICompatibleError || error instanceof AnthropicError) {
    const kind = (error as { kind?: string }).kind;
    const status = (error as { status?: number }).status;
    const isTimeout = kind === 'timeout';
    const isRateLimited = kind === 'rate_limit' || status === 429 || /\b429\b|rate limit/i.test(error.message);
    return new ReviewIngestError(
      isTimeout
        ? `the AI provider did not respond in time — ${error.message}`
        : isRateLimited
          ? 'the AI provider is rate-limited (HTTP 429) — wait a moment and try again, or raise /REVIEW_MAX_CONCURRENCY, or upgrade the provider plan'
          : `the AI provider failed — ${error.message}`,
      isTimeout ? 504 : isRateLimited ? 429 : 502,
    );
  }
  // A reasoning model whose output budget was exhausted returns truncated
  // JSON; parsing it fails with a ReviewParseError. That is still an
  // upstream/AI problem (retry-able, not a code defect), so surface it as
  // a 502 rather than leaking an unhelpful 500.
  if (error instanceof ReviewParseError) {
    const isTruncated = error.message.includes('truncated');
    return new ReviewIngestError(
      isTruncated
        ? 'AI output was truncated — increase AI_MAX_TOKENS or reduce the diff size'
        : 'AI review output was not valid JSON — try again',
      isTruncated ? 502 : 400,
    );
  }
  return undefined;
}

/**
 * Resolve the operator-supplied instructions / skill text ("text.md") for the
 * PR + Jira + text.md + AI flow. Returns the uploaded content when the
 * `includeInstructions` triage toggle is ON and the content is non-empty,
 * otherwise `undefined` (falling back to the PR + Jira + AI flow).
 */
export async function resolveInstructions(db: DrizzleDB): Promise<string | undefined> {
  const state = await loadTriageRuleState(db);
  if (!state.includeInstructions) {
    return undefined;
  }
  const content = state.instructionsContent.trim();
  return content.length > 0 ? content : undefined;
}

/**
 * Resolve the operator's thinking budget (Triage Rules page `reasoningEffort`)
 * into the `reasoning_effort` value sent on every review LLM call.
 * `'off'` → `'none'` (ask for no thinking), `'low'` → `'low'` (cap the
 * trace), `'default'` → `undefined` (send nothing — model default).
 */
export async function resolveReasoningEffort(db: DrizzleDB): Promise<'none' | 'low' | undefined> {
  const state = await loadTriageRuleState(db);
  if (state.reasoningEffort === 'off') return 'none';
  if (state.reasoningEffort === 'low') return 'low';
  return undefined;
}

/**
 * Build the pipeline options shared by the sync + async paths: the PR
 * context, token budget, review-mode overrides, and the lazily-resolved
 * operator instructions.
 */
export async function buildPipelineOptions(
  deps: { db: DrizzleDB; model: string; autoReviewMode?: boolean },
  prUrl: string,
  prTitle: string,
  requirement: string,
  correlationId: string,
  inputAutoReviewMode: boolean | undefined,
) {
  return {
    prUrl,
    prTitle,
    requirement,
    model: deps.model,
    correlationId,
    maxAgentTokens: envInt('AI_MAX_TOKENS', 32_000),
    ...(deps.autoReviewMode !== undefined ? { autoReviewMode: deps.autoReviewMode } : {}),
    ...(inputAutoReviewMode !== undefined ? { autoReviewMode: inputAutoReviewMode } : {}),
    ...(await resolveInstructions(deps.db).then((instructions) =>
      instructions !== undefined ? { instructions } : {},
    )),
  };
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
export async function runReviewPipeline(
  deps: ReviewPipelineDeps,
  files: readonly PullRequestFile[],
  opts: ReviewPipelineOptions,
  onBatch?: (batchIndex: number, batchCount: number, output: ReviewAgentOutput) => Promise<void>,
) {
  const { reviewAgent, memoryProvider, twoPassEnabled, maxBatchSize, maxBatchTokens, maxConcurrency } = deps;

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

  // Operator thinking budget (Triage Rules page `reasoningEffort`): forwarded
  // to every review + triage-summary LLM call so a thinking model doesn't burn
  // the whole `AI_MAX_TOKENS` budget on chain-of-thought. `undefined` = model
  // default (pre-setting behaviour).
  const reasoningEffort = await resolveReasoningEffort(deps.db);

  // Within-PR impact edges: which changed files import which other changed
  // files. Forwarded to the triage pass and every review batch so a shared
  // function/component change enumerates all its visible callers instead of
  // being judged locally. Usages outside the PR stay unknown by design.
  const impactScope = buildImpactScope(reviewable);

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
        ...(opts.instructions !== undefined ? { instructions: opts.instructions } : {}),
        // The triage gate decides which files earn a deep review — it must
        // see the same past-review context as the review pass, otherwise a
        // file with a known-bad history can be gated out before review.
        ...(relatedMemories !== undefined && relatedMemories.length > 0 ? { relatedMemories } : {}),
        // ...and the same caller context, so a shared file with in-PR
        // callers is not gated to "low risk" before impact is traced.
        ...(impactScope.length > 0 ? { impactScope } : {}),
      },
      {
        model: opts.model,
        correlationId: opts.correlationId,
        ...(opts.maxAgentTokens !== undefined ? { maxTokens: opts.maxAgentTokens } : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
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
    maxTokens: maxBatchTokens ?? 16_000,
    maxSources: maxBatchSize ?? 5,
  });

  // If budgeted primary is empty, use the first batch-worth of files.
  const filesToReview =
    budgeted.primary.length > 0
      ? [...budgeted.primary, ...budgeted.overflow] // Include ALL files, not just primary
      : targetFiles.slice(0, maxBatchSize ?? 5);

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
      maxBatchTokens: maxBatchTokens ?? 16_000,
      maxConcurrency: maxConcurrency ?? 4,
      ...(opts.autoReviewMode !== undefined ? { autoReviewMode: opts.autoReviewMode } : {}),
      ...(opts.maxAgentTokens !== undefined ? { maxAgentTokens: opts.maxAgentTokens } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(relatedMemories !== undefined && relatedMemories.length > 0 ? { relatedMemories } : {}),
      ...(opts.instructions !== undefined && opts.instructions.length > 0 ? { instructions: opts.instructions } : {}),
      ...(impactScope.length > 0 ? { impactScope } : {}),
      // A batch that permanently fails (after retries) is skipped so the rest
      // of the review still completes — log it here for visibility/audit.
      onBatchFailure: (batchIndex: number, attempts: number, error: unknown) => {
        const logger = deps.logger;
        if (attempts >= 3) {
          logger.warn('review batch skipped after retries', {
            correlation_id: opts.correlationId,
            report_id: opts.correlationId,
            batch_index: batchIndex,
            attempts,
            error: error instanceof Error ? error.message : String(error),
          });
        } else {
          logger.warn('review batch failed (permanent error, not retried)', {
            correlation_id: opts.correlationId,
            report_id: opts.correlationId,
            batch_index: batchIndex,
            attempts,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    } as unknown as BatchReviewOptions,
    onBatch,
  );
}

/**
 * Recall past review context for the async path's progress stage: map the
 * memory provider's retrieval results (with relevance) into the shape stored
 * on `review_reports.recalled_memories`. Returns `null` when nothing was
 * recalled.
 */
export async function recallMemories(
  memoryProvider: MemoryProvider | undefined,
  prTitle: string,
  requirement: string,
): Promise<unknown> {
  if (!memoryProvider) {
    return null;
  }
  const rawMemories = await memoryProvider.retrieve({
    text: `${prTitle} ${requirement}`,
    limit: 5,
  });
  if (rawMemories === undefined || rawMemories.length === 0) {
    return null;
  }
  return rawMemories.map((m) => ({
    kind: m.entry.kind,
    content: m.entry.content,
    confidence: m.entry.confidence,
    metadata: m.entry.metadata,
    relevance: m.relevance,
  }));
}
