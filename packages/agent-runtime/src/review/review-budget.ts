/**
 * Context-aware file budgeting (Phase 4 upgrade) — rank PR files by relevance
 * to a set of keywords, then apply a token budget to separate primary (in-budget)
 * from overflow files.
 *
 * Uses keyword-overlap logic (mirroring `KeywordDependencyRanker` from
 * `@harness/context-engine`) to compute a relevance score for each file based on
 * keyword overlap in its path and patch content. High-relevance files go into the
 * `primary` batch; the rest go into `overflow` (to be reviewed later, or skipped
 * when budget is tight).
 */

import type { PullRequestFile } from '@harness/domain';

/** Options for {@link budgetFiles}. */
export interface BudgetFilesOptions {
  /**
   * Keywords to rank against. These typically come from the PR title, requirement
   * text, or the project's relevant domain vocabulary.
   */
  readonly keywords: string[];
  /** Max total tokens for the primary batch (including system prompt + response buffer). */
  readonly maxTokens: number;
  /** Max number of files that can be in the primary batch. */
  readonly maxSources: number;
}

/** Result of {@link budgetFiles}. */
export interface BudgetFilesResult {
  /** Files that fit within the budget, ranked by relevance (highest first). */
  readonly primary: PullRequestFile[];
  /** Files that exceed the budget, sorted by relevance (highest first). */
  readonly overflow: PullRequestFile[];
  /** Relevance scores keyed by file path. */
  readonly scores: ReadonlyMap<string, number>;
}

/**
 * Rank PR files by keyword relevance and apply a token budget.
 *
 * Only files with non-empty patches are ranked. The result splits files into
 * `primary` (within budget, highest relevance) and `overflow` (rest).
 */
export function budgetFiles(
  files: readonly PullRequestFile[],
  opts: BudgetFilesOptions,
): BudgetFilesResult {
  const reviewable = files.filter((f) => f.patch.trim().length > 0);
  if (reviewable.length === 0) {
    return { primary: [], overflow: [], scores: new Map() };
  }

  // Score each file by keyword overlap in path + patch content.
  const scored: Array<{ file: PullRequestFile; score: number }> = [];
  const scores = new Map<string, number>();

  for (const file of reviewable) {
    const score = keywordScore(file, opts.keywords);
    scored.push({ file, score });
    scores.set(file.path, score);
  }

  // Sort by relevance descending.
  scored.sort((a, b) => b.score - a.score);

  // Apply budget: take highest-relevance files until we hit maxTokens or maxSources.
  const primary: PullRequestFile[] = [];
  const overflow: PullRequestFile[] = [];
  let tokensUsed = 0;

  for (const { file } of scored) {
    const fileTokens = estimateTokens(file);

    if (
      primary.length < opts.maxSources &&
      (primary.length === 0 || tokensUsed + fileTokens <= opts.maxTokens)
    ) {
      primary.push(file);
      tokensUsed += fileTokens;
    } else {
      overflow.push(file);
    }
  }

  // Ensure at least one file in primary when there are reviewable files.
  if (primary.length === 0 && reviewable.length > 0) {
    primary.push(reviewable[0]!);
    overflow.shift();
  }

  return { primary, overflow, scores };
}

/**
 * Compute a relevance score (0–1) for a single file against a set of keywords.
 *
 * The score is the fraction of keywords that appear in the file's path or patch
 * content. This mirrors the `keywordOverlap` logic from `KeywordDependencyRanker`.
 */
function keywordScore(file: PullRequestFile, keywords: string[]): number {
  if (keywords.length === 0) return 0.5; // Neutral score when no keywords.

  const lowerPath = file.path.toLowerCase();
  const lowerPatch = file.patch.toLowerCase();

  let matchCount = 0;
  for (const kw of keywords) {
    const lowerKw = kw.toLowerCase();
    if (lowerPath.includes(lowerKw) || lowerPatch.includes(lowerKw)) {
      matchCount++;
    }
  }

  return matchCount / keywords.length;
}

/** Rough token estimate: ~4 chars per token + header buffer. */
function estimateTokens(file: PullRequestFile): number {
  const text = `=== ${file.path} ===\n${file.patch}`;
  return Math.ceil(text.length / 4) + 100; // 100 buffer for formatting
}
