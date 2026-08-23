/**
 * Retriever seam (day-26 §2.1) — one interface over the two Phase-2 retrievers.
 *
 * Phase 2 produced two independent ways to order collected files against a task:
 * the lexical keyword ranker (day-20, sync, `@see rank.js`) and the semantic
 * cosine ranker (day-18, async, `@see semantic-retriever.js`). They share a
 * result shape — *sourceId + content + a relevance score* — but not an
 * interface, and their scores are on incomparable scales (keyword overlap in
 * `[0,1]` vs cosine in `[-1,1]`). This file is the shared seam both adapt to, so
 * the {@link HybridRetriever} can run them concurrently and fuse by rank.
 *
 * Each retrieved doc carries a `matchedBy` provenance layer so the fused result
 * can say *which* retriever found it (and whether both did).
 */

/** The two retrieval layers that may feed a fused ranking. */
export type MatchLayer = 'lexical' | 'semantic';

/** Provenance of a fused doc: one layer found it, or both (an overlap match). */
export type MatchedBy = MatchLayer | 'both';

/** A single collected document the retrievers rank (sourceId + raw content). */
export interface RetrievalDocument {
  readonly sourceId: string;
  readonly content: string;
}

/** The minimal retrieval request: query text + the corpus to rank against. */
export interface RetrievalQuery {
  readonly text: string;
  /** Files the task names explicitly — never dropped, ranked at top (lexical). */
  readonly targetFiles: readonly string[];
  /** The collected corpus (sourceId + content). */
  readonly documents: readonly RetrievalDocument[];
}

/** One ranked document, best-first, with its pre-fusion relevance score. */
export interface RetrievedDoc {
  readonly sourceId: string;
  readonly content: string;
  /** Retriever-specific relevance; incomparable across layers (see RRf). */
  readonly score: number;
  /** Which layer(s) produced this doc (single-layer for a lone retriever). */
  readonly matchedBy: MatchedBy;
}

/** The retriever seam: rank a corpus against a query, best-first. */
export interface Retriever {
  /** Stable provenance label for the ranking it produces. */
  readonly method: string;
  retrieve(query: RetrievalQuery): Promise<RetrievedDoc[]>;
}
