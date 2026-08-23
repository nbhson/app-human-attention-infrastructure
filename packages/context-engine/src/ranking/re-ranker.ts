/**
 * Re-rank stage (day-27 §2.1, §2.2) — re-order the fused top-N, never widen it.
 *
 * The pipeline is `HybridRetriever → RRF top-N → ReRanker → trim`. The re-ranker
 * receives the fused documents and re-sorts them by a blend of their RRF score
 * (normalized across the set) and three context-aware signals — dependency
 * proximity, recency, usage. It maps 1:1 over its input, so it can never add a
 * candidate the fusion dropped (day-27 §6: re-rank re-orders, never recalls).
 *
 * It consumes the dependency signal through an injected
 * {@link DependencyProximityResolver} seam — it never imports `@harness/code-index`
 * directly (context-engine is an engine; code-index is a data leaf, day-27 §2.3).
 * With no resolver wired, dependency falls to the neutral 0.5 and the blend still
 * serves a coherent, fusion-dominant order (a documented cold-graph fallback).
 *
 * The output shape is {@link RankedFile} so it drops straight into the existing
 * `applyBudget` trim (day-20 §2.4) at the Day-29 cutover.
 */

import type { RankedFile } from '../rank.js';
import type { RetrievedDoc } from '../retrieval/retriever.js';
import {
  dependencySignal,
  NEUTRAL_SIGNAL,
  PLACEHOLDER_RE_RANK_WEIGHTS,
  recencySignal,
  usageSignal,
} from './signals.js';
import type { DependencyProximityResolver, ReRankWeights } from './signals.js';

/** The re-rank inputs: fused docs + per-source side signals. */
export interface ReRankInput {
  /** The fused top-N (RRF output), already deduplicated by sourceId. */
  readonly fused: readonly RetrievedDoc[];
  /** The changed files that seed dependency proximity. */
  readonly changedFiles: readonly string[];
  /** Per-source mtime (ms epoch) for recency; absent → neutral. */
  readonly mtimeMs?: ReadonlyMap<string, number>;
  /** Per-source retrieval count for usage; absent → neutral. */
  readonly retrievalCount?: ReadonlyMap<string, number>;
  /**
   * Per-source **learned** usage signal from {@link UsageLearner} (day-32), already
   * in `[0,1]` around neutral 0.5. When present it supersedes `retrievalCount` —
   * the day-27 raw-popularity term. Absent OR a source missing from the map → the
   * neutral fallback, so an unobserved source is never demoted by its own silence.
   */
  readonly learnedUsage?: ReadonlyMap<string, number>;
}

export class ReRanker {
  constructor(
    private readonly dependencyResolver?: DependencyProximityResolver,
    private readonly weights: ReRankWeights = PLACEHOLDER_RE_RANK_WEIGHTS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Re-sort the fused docs by the weighted blend; a pure 1:1 re-order. */
  reRank(input: ReRankInput): RankedFile[] {
    const maxScore = input.fused.reduce((max, doc) => Math.max(max, doc.score), 0);
    const nowMs = this.now();

    const ranked = input.fused.map((doc) => {
      const fusion = maxScore > 0 ? doc.score / maxScore : 0;
      const dependency = dependencySignal(
        this.dependencyResolver,
        input.changedFiles,
        doc.sourceId,
      );
      const recency = recencySignal(input.mtimeMs?.get(doc.sourceId), nowMs);
      // Day-32 learned usage supersedes the day-27 raw-popularity term when wired.
      const usage =
        input.learnedUsage !== undefined
          ? (input.learnedUsage.get(doc.sourceId) ?? NEUTRAL_SIGNAL)
          : usageSignal(input.retrievalCount?.get(doc.sourceId));

      const relevanceScore =
        this.weights.fusion * fusion +
        this.weights.dependency * dependency +
        this.weights.recency * recency +
        this.weights.usage * usage;

      return { sourceId: doc.sourceId, content: doc.content, relevanceScore };
    });

    return ranked.sort(
      (a, b) => b.relevanceScore - a.relevanceScore || a.sourceId.localeCompare(b.sourceId),
    );
  }
}
