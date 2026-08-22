/**
 * Budget trimming (day-20 §2.4) — the Phase-1 compressor is TRUNCATE-only.
 *
 * Priority rules (Spec 4 §6), in order:
 *  1. Never remove a `targetFiles` entry or its content.
 *  2. Sort the rest by score desc; drop anything below `minRelevanceThreshold`.
 *  3. Greedily add until `maxTokens`; the first source that doesn't fit is
 *     truncated to the remainder (with a `… [truncated]` marker), and every
 *     lower-ranked source is dropped.
 *  4. `totalTokens` is the post-trim count.
 */

import { createHash } from 'node:crypto';

import { CompressionStrategy, ContextSourceType, createContextSource } from '@harness/domain';
import type { ContextPolicy, ContextSource } from '@harness/domain';

import type { RankedFile } from './rank.js';
import type { Tokenizer } from './types.js';

/** The ranking method stamped on the snapshot (day-20 §2.3 / §6). */
export const RANK_METHOD = 'phase1-keyword-dependency';

/** Suffix appended to a truncated source body (§2.4). */
export const TRUNCATION_MARKER = '\n… [truncated]';

/** The Phase-1 default policy (§2.3, §2.4). */
export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  maxSources: 20,
  maxTokensPerSource: 4000,
  minRelevanceThreshold: 0.15,
  compressionStrategy: CompressionStrategy.Truncate,
  includeGitHistory: false,
  includeArchitecture: false,
  includePreviousDecisions: false,
  includeRuntimeEvidence: false,
};

/** The trimmed result handed to (and persisted by) the engine. */
export interface BudgetedContext {
  readonly sources: ContextSource[];
  readonly totalTokens: number;
}

export interface BudgetOptions {
  readonly targetFiles: readonly string[];
  readonly tokenizer: Tokenizer;
  readonly maxTokens: number;
  readonly policy: ContextPolicy;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Build a full-content {@link ContextSource} from a ranked file. */
function toSource(
  file: RankedFile,
  tokenizer: Tokenizer,
  metadata: Record<string, unknown>,
): ContextSource {
  return createContextSource({
    type: ContextSourceType.File,
    sourceId: file.sourceId,
    relevanceScore: file.relevanceScore,
    content: file.content,
    tokenCount: tokenizer.count(file.content),
    contentHash: sha256(file.content),
    metadata,
  });
}

/**
 * Cut `content` down so `tokenizer.count(result) <= budgetTokens`, appending the
 * truncation marker. Returns `null` when the budget cannot even hold the marker.
 * Exact truncation is delegated to `tokenizer.truncate` (encode → slice → decode),
 * which preserves the priority rules above irrespective of the encoding.
 */
function truncateToFit(content: string, tokenizer: Tokenizer, budgetTokens: number): string | null {
  const markerTokens = tokenizer.count(TRUNCATION_MARKER);
  const contentTokenBudget = budgetTokens - markerTokens;
  if (contentTokenBudget <= 0) return null;
  return tokenizer.truncate(content, contentTokenBudget) + TRUNCATION_MARKER;
}

/** Apply the §2.4 priority rules to a ranked candidate list. */
export function applyBudget(
  ranked: readonly RankedFile[],
  options: BudgetOptions,
): BudgetedContext {
  const { targetFiles, tokenizer, maxTokens, policy } = options;
  const targetSet = new Set(targetFiles);

  const targetMatches = ranked.filter((file) => targetSet.has(file.sourceId));
  const otherFiles = ranked
    .filter((file) => !targetSet.has(file.sourceId))
    .filter((file) => file.relevanceScore >= policy.minRelevanceThreshold)
    .slice(0, policy.maxSources);

  const sources: ContextSource[] = [];
  let totalTokens = 0;

  // §2.4 rule 1 — target files are always included, in full.
  for (const file of targetMatches) {
    const source = toSource(file, tokenizer, { target: true });
    sources.push(source);
    totalTokens += source.tokenCount;
  }

  // §2.4 rules 2–3 — non-targets in score order; the first that doesn't fit is
  // truncated, and everything below it is dropped.
  let remaining = maxTokens - totalTokens;
  for (const file of otherFiles) {
    if (remaining <= 0) break;

    const fullTokenCount = tokenizer.count(file.content);
    if (fullTokenCount <= remaining) {
      const source = toSource(file, tokenizer, {});
      sources.push(source);
      totalTokens += source.tokenCount;
      remaining -= source.tokenCount;
      continue;
    }

    const truncated = truncateToFit(file.content, tokenizer, remaining);
    if (truncated === null) {
      // No room for even the marker — drop this and everything below it.
      break;
    }
    sources.push(
      createContextSource({
        type: ContextSourceType.File,
        sourceId: file.sourceId,
        relevanceScore: file.relevanceScore,
        content: truncated,
        tokenCount: tokenizer.count(truncated),
        // Hash the *original* content so Day-21 freshness compares against the
        // real file, not the budget-trimmed view.
        contentHash: sha256(file.content),
        metadata: {},
      }),
    );
    totalTokens += tokenizer.count(truncated);
    break;
  }

  // §2.2 — a snapshot carries its sources in descending relevance order.
  sources.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return { sources, totalTokens };
}
