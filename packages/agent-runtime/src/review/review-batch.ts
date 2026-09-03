/**
 * Batch review (Phase 4 upgrade) — split a large PR's files into smaller batches,
 * review each batch in parallel, and merge the results.
 *
 * The splitting is token-aware: each batch stays under a configurable token budget
 * so individual AI calls finish before the provider timeout. Files are grouped by
 * path prefix to keep related files together (same directory → same batch), which
 * gives the AI more context per call.
 */

import type { PullRequestFile } from '@harness/domain';

import { OpenAICompatibleError } from '../llm/openai-compatible-provider.js';
import { ReviewParseError } from './parse-review.js';
import { ReviewAgent } from './review-agent.js';
import type { ReviewAgentOptions } from './review-agent.js';
import type { ReviewPromptInput } from './review-prompt.js';
import type { ReviewAgentOutput, ReviewFindingOutput, FixSuggestionOutput } from './review-output.js';

/** Default max files per batch. */
const DEFAULT_MAX_BATCH_SIZE = 5;
/** Default max tokens per batch (conservative, 8k leaves room for the system prompt + response). */
const DEFAULT_MAX_BATCH_TOKENS = 8000;
/** Default concurrent AI requests — kept low so free-tier/proxied endpoints
 *  aren't hammered into 429s (they fire request-burst rate limits fast). */
const DEFAULT_MAX_CONCURRENCY = 4;
/** Attempts per batch before giving up (1 initial + 2 retries). */
const MAX_BATCH_ATTEMPTS = 3;
/** Base delay in ms; doubled per attempt (e.g. 1s → 2s → 4s). */
const BATCH_RETRY_BASE_MS = 1_000;

/** Called whenever a batch has exhausted its retries and will be skipped (multi-batch only). */
export type BatchFailureCallback = (batchIndex: number, attempts: number, error: unknown) => void;

/** Options for {@link batchReview}. */
export interface BatchReviewOptions {
  readonly prUrl: string;
  readonly prTitle: string;
  readonly requirement: string;
  readonly model: string;
  readonly correlationId: string;
  /** Max tokens per batch (default 8000). */
  readonly maxBatchTokens?: number;
  /** Max files per batch (default 5). */
  readonly maxBatchSize?: number;
  /** Optional past memories to inject into every batch's prompt. */
  readonly relatedMemories?: ReviewPromptInput['relatedMemories'];
  /** Optional operator instructions / skill text injected into every batch's prompt. */
  readonly instructions?: ReviewPromptInput['instructions'];
  /** Max tokens for the agent's response per batch (default 8000). */
  readonly maxAgentTokens?: number;
  /**
   * Max concurrent AI requests (default 4).
   * Prevents overwhelming the provider with too many parallel calls.
   * Raise on a provider with generous rate limits; lower on a strict one
   * (free-tier endpoints often burst-limited to 1–3 concurrent calls).
   */
  readonly maxConcurrency?: number;
  /**
   * When true, the reviewer operates in full code-review mode — surfacing ALL
   * findings including MINOR, NIT, and INFO (style, naming, architecture, etc.).
   * When false (default), the reviewer filters to high-signal items only.
   */
  readonly autoReviewMode?: boolean;
  /**
   * Called when a batch has exhausted its retries and will be SKIPPED so the
   * rest of the review can still complete (multi-batch reviews only). A single
   * batch that fails still surfaces as a hard error and is not reported here.
   */
  readonly onBatchFailure?: BatchFailureCallback;
}

/**
 * Build a review input for a single batch, optionally including related memories.
 */
function buildReviewInput(
  batch: readonly PullRequestFile[],
  opts: {
    prUrl: string;
    prTitle: string;
    requirement: string;
    relatedMemories?: ReviewPromptInput['relatedMemories'];
    instructions?: ReviewPromptInput['instructions'];
    autoReviewMode?: boolean;
  },
): ReviewPromptInput {
  return {
    prUrl: opts.prUrl,
    prTitle: opts.prTitle,
    requirement: opts.requirement,
    diff: buildDiff(batch),
    autoReviewMode: opts.autoReviewMode,
    ...(opts.relatedMemories !== undefined ? { relatedMemories: opts.relatedMemories } : {}),
    ...(opts.instructions !== undefined ? { instructions: opts.instructions } : {}),
  } as ReviewPromptInput;
}

/**
 * Build agent options, conditionally including optional fields for
 * `exactOptionalPropertyTypes` compatibility.
 */
function buildAgentOptions(model: string, correlationId: string, maxTokens?: number): ReviewAgentOptions {
  return {
    model,
    correlationId,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  } as ReviewAgentOptions;
}

/**
 * Review a set of PR files in parallel batches, returning merged results.
 * When `files` fits in a single batch, behaves identically to a single
 * `ReviewAgent.review()` call.
 *
 * When `onBatch` is provided, it is called after each batch completes (in
 * resolution order, not submission order) so the caller can progressively
 * store findings as batches finish.
 */
export async function batchReview(
  agent: ReviewAgent,
  files: readonly PullRequestFile[],
  opts: BatchReviewOptions,
  onBatch?: (batchIndex: number, batchCount: number, output: ReviewAgentOutput) => Promise<void>,
): Promise<ReviewAgentOutput> {
  const batches = splitFiles(files, {
    maxBatchTokens: opts.maxBatchTokens ?? DEFAULT_MAX_BATCH_TOKENS,
    maxBatchSize: opts.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
  });

  if (batches.length === 0) {
    return { summary: '', overallVerdict: 'COMMENT' as const, findings: [], suggestions: [] };
  }

  const concurrency = opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

  // Single batch — fast path, no merge overhead. A failure here is the whole
  // review, so it is retried but never silently skipped (never yields null).
  if (batches.length === 1) {
    const output = (await reviewBatchWithRetry(agent, batches[0]!, 0, 1, opts)) as ReviewAgentOutput;
    if (onBatch) {
      await onBatch(0, 1, output);
    }
    return output;
  }

  // Multiple batches — limited concurrency so the provider doesn't get
  // overwhelmed. Each batch is retried on transient failures, and a batch that
  // permanently fails is SKIPPED so the other batches' findings still land.
  const results = await mapConcurrent(
    batches,
    async (batch, index) =>
      reviewBatchWithRetry(agent, batch, index, batches.length, opts).then((output) => {
        if (output !== null && onBatch) {
          return onBatch(index, batches.length, output).then(() => output);
        }
        return output;
      }),
    concurrency,
  );

  const succeeded = results.filter((output): output is ReviewAgentOutput => output !== null);
  if (succeeded.length === 0) {
    // Every batch failed — surface the original failure rather than a hollow
    // "complete" report with zero findings.
    throw new ReviewParseError('AI review failed: every batch was skipped after retries');
  }
  return mergeOutputs(succeeded);
}

/**
 * Run a single batch's review with retry + exponential backoff.
 *
 * Transient failures (provider timeout, network drop, HTTP 429/5xx, and model
 * JSON/truncation flakiness that the parser rejects) are retried up to
 * `MAX_BATCH_ATTEMPTS`. On final failure:
 *  - a single-batch review throws, so the caller sees an honest error;
 *  - a multi-batch review returns `null` (the caller skips it and keeps the rest).
 *
 * `onBatch` runs exactly once per successfully-reviewed batch, AFTER retries,
 * so a restored batch never double-inserts findings.
 */
async function reviewBatchWithRetry(
  agent: ReviewAgent,
  batch: readonly PullRequestFile[],
  index: number,
  totalBatches: number,
  opts: BatchReviewOptions,
): Promise<ReviewAgentOutput | null> {
  const input = buildReviewInput(batch, {
    prUrl: opts.prUrl,
    prTitle: opts.prTitle,
    requirement: opts.requirement,
    // Only pass memories to the first batch to avoid repetition.
    ...(index === 0 && opts.relatedMemories !== undefined ? { relatedMemories: opts.relatedMemories } : {}),
    // Instructions apply to every batch — the operator's guidance is uniform.
    ...(opts.instructions !== undefined ? { instructions: opts.instructions } : {}),
    ...(opts.autoReviewMode !== undefined ? { autoReviewMode: opts.autoReviewMode } : {}),
  });
  const agentOpts = buildAgentOptions(opts.model, opts.correlationId, opts.maxAgentTokens);

  let lastError: unknown;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      return await agent.review(input, agentOpts);
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_BATCH_ATTEMPTS || !isTransientBatchError(error)) {
        break;
      }
      const delayMs = BATCH_RETRY_BASE_MS * 2 ** (attempt - 1);
      await sleep(delayMs);
    }
  }

  // A single batch that truly fails must fail the review honestly.
  if (totalBatches === 1) {
    throw lastError;
  }
  // Otherwise report the skip so callers can log it, then continue the review.
  opts.onBatchFailure?.(index, attempts, lastError);
  return null;
}

/**
 * Classify a per-batch failure. `timeout`/`network`/HTTP 429/5xx are transient
 * provider pressure; a JSON parse failure is model flakiness that almost always
 * clears on a fresh generation (the parser already salvages most shapes, so a
 * surviving `ReviewParseError` is worth one more roll of the dice). Everything
 * else (auth, malformed request, …) is permanent and fails fast.
 */
function isTransientBatchError(error: unknown): boolean {
  if (error instanceof OpenAICompatibleError) {
    if (error.kind === 'timeout' || error.kind === 'network') {
      return true;
    }
    if (error.kind === 'http' && /\b429\b|5\d\d|rate limit/i.test(error.message)) {
      return true;
    }
    return false;
  }
  if (error instanceof ReviewParseError) {
    return true;
  }
  return error instanceof Error && /truncated|timed out|ECONNRESET|ETIMEDOUT|429|5\d\d|rate limit/i.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── File splitting ───────────────────────────────────────────────────────────

interface SplitOptions {
  readonly maxBatchTokens: number;
  readonly maxBatchSize: number;
}

/**
 * Split PR files into token-aware batches. Files are grouped by directory
 * prefix first, then split when a batch exceeds the token budget or size limit.
 */
export function splitFiles(files: readonly PullRequestFile[], opts: SplitOptions): PullRequestFile[][] {
  if (files.length === 0) return [];

  // Filter to files with non-empty patches (reviewable).
  const reviewable = files.filter((f) => f.patch.trim().length > 0);
  if (reviewable.length === 0) return [];

  // Group by directory for coherence.
  const byDir = new Map<string, PullRequestFile[]>();
  for (const file of reviewable) {
    const dir = dirname(file.path);
    const group = byDir.get(dir) ?? [];
    group.push(file);
    byDir.set(dir, group);
  }

  // Flatten directory groups into batches, splitting when budget is exceeded.
  const batches: PullRequestFile[][] = [];
  let currentBatch: PullRequestFile[] = [];
  let currentTokens = 0;

  for (const [, dirFiles] of byDir) {
    // If this directory alone exceeds maxBatchSize, split it into smaller groups.
    const subGroups = splitLargeGroup(dirFiles, opts.maxBatchSize);

    for (const group of subGroups) {
      const groupTokens = estimateTokens(group);

      // Can we add this group to the current batch?
      if (
        currentBatch.length > 0 &&
        (currentBatch.length + group.length > opts.maxBatchSize || currentTokens + groupTokens > opts.maxBatchTokens)
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }

      // If a single group exceeds the budget, it goes in its own batch anyway.
      if (currentBatch.length === 0 && group.length > 0) {
        currentBatch = [...group];
        currentTokens = groupTokens;
      } else if (group.length > 0) {
        currentBatch.push(...group);
        currentTokens += groupTokens;
      }
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/** Split a large file group into sub-groups of at most `maxSize`. */
function splitLargeGroup(files: PullRequestFile[], maxSize: number): PullRequestFile[][] {
  if (files.length <= maxSize) return [files];
  const groups: PullRequestFile[][] = [];
  for (let i = 0; i < files.length; i += maxSize) {
    groups.push(files.slice(i, i + maxSize));
  }
  return groups;
}

/** Rough token estimate for a set of files: ~4 chars per token + header buffer. */
function estimateTokens(files: readonly PullRequestFile[]): number {
  const text = files.map((f) => `=== ${f.path} ===\n${f.patch}`).join('\n\n');
  return Math.ceil(text.length / 4) + 200; // 200 buffer for formatting
}

/** Build a unified diff string from a batch of files (mirrors review-ingest.ts buildDiff). */
function buildDiff(files: readonly PullRequestFile[]): string {
  return files
    .filter((f) => f.patch.trim().length > 0)
    .map((f) => `=== ${f.path} (${f.status}, +${f.additions} -${f.deletions}) ===\n${f.patch}`)
    .join('\n\n');
}

/** Get the directory name from a file path (posix). */
function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '.';
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Process items with a limited number of concurrent workers.
 * Each worker picks the next available item, ensuring we never exceed
 * `concurrency` in-flight promises. Results are returned in input order.
 */
async function mapConcurrent<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex;
      if (i >= items.length) break;
      nextIndex = i + 1;

      results[i] = await fn(items[i]!, i);
    }
  }

  const count = Math.min(concurrency, items.length);
  const workers = Array.from({ length: count }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Merge multiple review outputs into one. Findings and suggestions are
 * concatenated, deduplicated by (file, message) hash, and sorted by severity
 * then file. The summary is taken from the first batch; the overall verdict is
 * the most conservative (REQUEST_CHANGES > COMMENT > APPROVE).
 */
export function mergeOutputs(outputs: readonly ReviewAgentOutput[]): ReviewAgentOutput {
  if (outputs.length === 0) {
    return { summary: '', overallVerdict: 'COMMENT' as const, findings: [], suggestions: [] };
  }
  if (outputs.length === 1) {
    return outputs[0]!;
  }

  // Merge findings — deduplicate by (file, message) fingerprint.
  const seen = new Set<string>();
  const allFindings: ReviewFindingOutput[] = [];
  for (const output of outputs) {
    for (const finding of output.findings) {
      const key = `${finding.file}:${finding.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allFindings.push(finding);
    }
  }
  allFindings.sort(bySeverityThenFile);

  // Merge suggestions — deduplicate by (file, proposed) fingerprint.
  const seenSug = new Set<string>();
  const allSuggestions: FixSuggestionOutput[] = [];
  for (const output of outputs) {
    for (const suggestion of output.suggestions) {
      const key = `${suggestion.file}:${suggestion.proposed}`;
      if (seenSug.has(key)) continue;
      seenSug.add(key);
      allSuggestions.push(suggestion);
    }
  }
  allSuggestions.sort((a, b) => a.file.localeCompare(b.file));

  const first = outputs[0]!;
  // Summary: first batch's summary, with a note if multi-batch.
  const summary =
    first.summary +
    (outputs.length > 1
      ? `\n\n(Review was split into ${outputs.length} batches. See individual findings for details.)`
      : '');

  // Verdict: most conservative wins.
  const verdictOrder: Record<string, number> = {
    REQUEST_CHANGES: 0,
    COMMENT: 1,
    APPROVE: 2,
  };
  let worstVerdict = first.overallVerdict;
  let worstRank = verdictOrder[worstVerdict] ?? 1;
  for (let i = 1; i < outputs.length; i++) {
    const rank = verdictOrder[outputs[i]!.overallVerdict] ?? 1;
    if (rank < worstRank) {
      worstRank = rank;

      worstVerdict = outputs[i]!.overallVerdict;
    }
  }

  return {
    summary,
    overallVerdict: worstVerdict as ReviewAgentOutput['overallVerdict'],
    findings: allFindings,
    suggestions: allSuggestions,
  };
}

/**
 * Sort findings by severity (CRITICAL first), then file path.
 * Severity ranking: CRITICAL=0, MAJOR=1, MINOR=2, NIT=3, INFO=4.
 */
function bySeverityThenFile(a: ReviewFindingOutput, b: ReviewFindingOutput): number {
  const severityRank: Record<string, number> = {
    CRITICAL: 0,
    MAJOR: 1,
    MINOR: 2,
    NIT: 3,
    INFO: 4,
  };
  const rankA = severityRank[a.severity] ?? 5;
  const rankB = severityRank[b.severity] ?? 5;
  if (rankA !== rankB) return rankA - rankB;
  return a.file.localeCompare(b.file);
}
