/**
 * Reciprocal rank fusion (day-26 §2.2) — the deterministic, normalization-free
 * way to blend two incompatible relevances.
 *
 * `score(d) = Σ 1/(k + rank_i(d))` over the layers that listed `d`. Only *ranks*
 * feed the score, so a BM25/lexical score and a cosine similarity — which live on
 * incomparable scales — never need normalizing against each other. The constant
 * `k` (60) damps the tail so top ranks dominate without a hard clipping rule.
 *
 * The function is deliberately pure and sourceId-based: it takes de-duplicated
 * rankings and returns a fused sourceId → RRF-score ordering. Content and
 * `matchedBy` attribution are the {@link HybridRetriever}'s job, not this
 * function's — it knows nothing about documents, only ranks.
 */

/** The RRF damping constant (day-26 §2.2). */
export const RRF_K = 60;

/** One fused result: a sourceId and its RRF score (already sorted, best-first). */
export interface RrfResult {
  readonly sourceId: string;
  readonly score: number;
}

/**
 * Fuse `layers` of sourceId rankings into one ranking by reciprocal rank.
 *
 * Each layer is a best-first ranking of sourceIds. A sourceId appearing in
 * multiple layers accrues `1/(k+rank)` from each, so overlap rises above any
 * single-layer appearance (day-26 §6: overlap is one stronger candidate, not
 * two). Within a layer, first occurrence wins and later duplicates are skipped —
 * a retriever should never emit a sourceId twice, and RRF does not reward it if
 * it does.
 *
 * Ties (equal fused score) break by sourceId ascending, so the result is fully
 * deterministic for a fixed input.
 */
export function reciprocalRankFusion(layers: readonly (readonly string[])[], k = RRF_K): RrfResult[] {
  const scores = new Map<string, number>();

  for (const layer of layers) {
    const seen = new Set<string>();
    let rank = 0;
    for (const sourceId of layer) {
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      rank += 1;
      scores.set(sourceId, (scores.get(sourceId) ?? 0) + 1 / (k + rank));
    }
  }

  return [...scores.entries()]
    .map(([sourceId, score]) => ({ sourceId, score }))
    .sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId));
}
