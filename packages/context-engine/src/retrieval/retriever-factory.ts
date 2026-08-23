/**
 * Retriever factory (day-26 §2.3, extended day-28 §3.3) — `rank_method` →
 * `Retriever` selection.
 *
 * Selection is config, not code: callers name a `rank_method` and get the
 * retriever for it, without any caller branching on which one exists. Today the
 * default is {@link RANK_METHOD_KEYWORD} (`'keyword'`) — hybrid and RAG fusion
 * are *reachable* but not the default; each earns default only by winning its
 * own measured A/B, never by being newer (day-26 §6, day-28 §2.2).
 *
 * Unknown or absent methods resolve to `keyword` — a mis-spelled rank_method is
 * a degraded ranking, not a crash.
 */

import { HybridRetriever } from './hybrid-retriever.js';
import type { QueryRewriter } from './query-rewriter.js';
import { DEFAULT_VARIANT_COUNT } from './query-rewriter.js';
import { RagFusionRetriever } from './rag-fusion-retriever.js';
import type { Retriever } from './retriever.js';

/** The day-26 default ranking method. */
export const RANK_METHOD_KEYWORD = 'keyword';
/** The fused method — selectable now, default only after Day 29's cutover. */
export const RANK_METHOD_HYBRID = 'hybrid';
/** The opt-in multi-query method (day-28 §2.2) — never the default. */
export const RANK_METHOD_RAG_FUSION = 'rag_fusion';

/** The resolvable rank methods. */
export type RankMethod =
  typeof RANK_METHOD_KEYWORD | typeof RANK_METHOD_HYBRID | typeof RANK_METHOD_RAG_FUSION;

/**
 * The production default `rank_method` (day-29 §2.2, §2.3).
 *
 * Cutover is a config change, not a code rewrite: this one resolved value is the
 * whole of "the default". It flips from {@link RANK_METHOD_KEYWORD} to
 * {@link RANK_METHOD_HYBRID} **only** on a measured WIN over the shared replay
 * corpus (`eval:ab-report`) — never by inheritance (day-29 §6, Phase-3 §8.4).
 *
 * The Day-29 A/B over replayed trajectories returned a **toss-up**: a replayed
 * run's consumption is fixed, so neither arm can move the replayed outcome, which
 * the harness answers honestly as `real-ab` (promote to a *live* A/B), not as a
 * WIN. The default therefore stays `keyword`; `hybrid` and `rag_fusion` remain
 * *selectable* per request (`rank_method`), and `hybrid` earns the default only
 * when a live, outcome-measuring comparison wins on the agreed primary metric
 * (rework down, context acceptance ≥). Reversible in seconds.
 */
export const DEFAULT_RANK_METHOD: RankMethod = RANK_METHOD_KEYWORD;

export class RetrieverFactory {
  private readonly hybrid: Retriever | null;
  private readonly ragFusion: Retriever | null;

  constructor(
    private readonly keyword: Retriever,
    semantic?: Retriever,
    rewriter?: QueryRewriter,
    variantCount: number = DEFAULT_VARIANT_COUNT,
  ) {
    // hybrid exists only when the semantic layer is wired in; rag_fusion wraps
    // the hybrid and exists only when a rewriter is supplied too. Without the
    // dependency, the method resolves to keyword (same as unknown).
    this.hybrid = semantic ? new HybridRetriever(keyword, semantic) : null;
    this.ragFusion =
      this.hybrid && rewriter ? new RagFusionRetriever(this.hybrid, rewriter, variantCount) : null;
  }

  /** Resolve a `rank_method` to its retriever; default (and unknown) → keyword. */
  resolve(rankMethod: string | undefined): Retriever {
    // Absent method falls to the gated {@link DEFAULT_RANK_METHOD}; an explicit
    // unknown method degrades to keyword (a mis-spelled rank_method is a degraded
    // ranking, not a crash).
    const target = rankMethod ?? DEFAULT_RANK_METHOD;
    if (target === RANK_METHOD_RAG_FUSION && this.ragFusion) {
      return this.ragFusion;
    }
    if (target === RANK_METHOD_HYBRID && this.hybrid) {
      return this.hybrid;
    }
    return this.keyword;
  }
}
