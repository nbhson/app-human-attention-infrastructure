/**
 * RAG-Fusion retriever (day-28 §2.1) — query expansion + RRF over the union.
 *
 * RAG fusion is recall-by-reformulation: rewrite the query into `k` variants,
 * run the base retriever once per query (the original plus each variant), and
 * fuse the **union** of every candidate set with the Day-26 RRF. A document that
 * several reformulations surface rises because it accrues `1/(k + rank)` from
 * each query's ranking — the same fuse that blends lexical/semantic, reused
 * unchanged (day-28 §2.1).
 *
 * It wraps any base `Retriever` (today the `HybridRetriever`, but the seam is
 * indifferent), so it proves the three methods — keyword / hybrid / rag_fusion —
 * are swappable through one interface (day-28 §3). It is **opt-in only** (§2.2):
 * `rank_method = 'rag_fusion'` names it explicitly, and nothing defaults to it.
 *
 * Correctness guard (day-28 §2.3): if variant generation fails — the rewriter
 * throws or returns nothing — this falls back to the base retriever on the
 * original query, so a rewrite failure can never degrade to an empty context.
 */

import type { QueryRewriter } from './query-rewriter.js';
import type { MatchedBy, RetrievedDoc, Retriever, RetrievalQuery } from './retriever.js';
import { reciprocalRankFusion } from './rrf.js';

export class RagFusionRetriever implements Retriever {
  readonly method = 'rag_fusion';

  constructor(
    private readonly base: Retriever,
    private readonly rewriter: QueryRewriter,
    private readonly variantCount = 3,
  ) {}

  async retrieve(query: RetrievalQuery): Promise<RetrievedDoc[]> {
    let variants: string[];
    try {
      variants = await this.rewriter.rewrite(query.text, this.variantCount);
    } catch {
      // §2.3: a failed rewrite is a single-query result, never an empty one.
      return this.base.retrieve(query);
    }
    if (variants.length === 0) {
      return this.base.retrieve(query);
    }

    // Original + variants, retrieved concurrently. The original query is always a
    // member of the union, so the single-query result is a strict subset.
    const queries = [query, ...variants.map((text) => ({ ...query, text }))];
    const layers = await Promise.all(queries.map((q) => this.base.retrieve(q)));

    // Build the RRF layers from each query's ranked sourceIds...
    const fused = reciprocalRankFusion(layers.map((docs) => docs.map((doc) => doc.sourceId)));

    // ...and re-attach content + matchedBy from the union of every layer's docs.
    const contentBySource = new Map<string, string>();
    const matchBySource = new Map<string, Set<MatchedBy>>();
    for (const docs of layers) {
      for (const doc of docs) {
        const seen = matchBySource.get(doc.sourceId) ?? new Set<MatchedBy>();
        seen.add(doc.matchedBy);
        matchBySource.set(doc.sourceId, seen);
        contentBySource.set(doc.sourceId, doc.content);
      }
    }

    return fused.map((entry) => ({
      sourceId: entry.sourceId,
      content: contentBySource.get(entry.sourceId) ?? '',
      score: entry.score,
      matchedBy: matchedByOf(matchBySource.get(entry.sourceId)),
    }));
  }
}

/** Collapse a source's layer labels across queries into one provenance label. */
function matchedByOf(layers: Set<MatchedBy> | undefined): MatchedBy {
  if (!layers || layers.size === 0) return 'lexical';
  if (layers.has('both')) return 'both';
  if (layers.has('lexical') && layers.has('semantic')) return 'both';
  return layers.has('semantic') ? 'semantic' : 'lexical';
}
