/**
 * Retriever factory (day-26 §2.3) — `rank_method` → `Retriever` selection.
 *
 * Selection is config, not code: callers name a `rank_method` and get the
 * retriever for it, without any caller branching on which one exists. Today the
 * default is {@link RANK_METHOD_KEYWORD} (`'keyword'`) — hybrid is *reachable*
 * but not the default; it earns default on Day 29's measured cutover, never by
 * being newer (day-26 §6).
 *
 * Unknown or absent methods resolve to `keyword` — a mis-spelled rank_method is
 * a degraded ranking, not a crash.
 */

import { HybridRetriever } from './hybrid-retriever.js';
import type { Retriever } from './retriever.js';

/** The day-26 default ranking method. */
export const RANK_METHOD_KEYWORD = 'keyword';
/** The fused method — selectable now, default only after Day 29's cutover. */
export const RANK_METHOD_HYBRID = 'hybrid';

/** The resolvable rank methods. */
export type RankMethod = typeof RANK_METHOD_KEYWORD | typeof RANK_METHOD_HYBRID;

export class RetrieverFactory {
  private readonly hybrid: Retriever | null;

  constructor(
    private readonly keyword: Retriever,
    semantic?: Retriever,
  ) {
    // hybrid exists only when the semantic layer is wired in; without it, the
    // `hybrid` method resolves to keyword (same as unknown).
    this.hybrid = semantic ? new HybridRetriever(keyword, semantic) : null;
  }

  /** Resolve a `rank_method` to its retriever; default (and unknown) → keyword. */
  resolve(rankMethod: string | undefined): Retriever {
    if (rankMethod === RANK_METHOD_HYBRID && this.hybrid) {
      return this.hybrid;
    }
    return this.keyword;
  }
}
