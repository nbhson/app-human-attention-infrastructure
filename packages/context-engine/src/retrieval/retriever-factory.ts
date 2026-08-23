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
    if (rankMethod === RANK_METHOD_RAG_FUSION && this.ragFusion) {
      return this.ragFusion;
    }
    if (rankMethod === RANK_METHOD_HYBRID && this.hybrid) {
      return this.hybrid;
    }
    return this.keyword;
  }
}
