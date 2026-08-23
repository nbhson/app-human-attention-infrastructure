/**
 * Semantic doc retriever (day-26 §2.1, §2.4) — the Phase-2 cosine retriever
 * behind the {@link Retriever} seam.
 *
 * This adapts the low-level {@link SemanticRetriever} (which returns
 * `SemanticCandidate[]` — a sourceId + stored vector + similarity, with **no**
 * file content) into the `RetrievedDoc` shape the hybrid composer needs: it joins
 * each candidate back to its sourceId's content in the collected corpus and
 * drops candidates whose sourceId is no longer in the corpus (a stale index row
 * for a removed file).
 *
 * It has no notion of freshness — that is {@link SemanticRanker}'s territory
 * (day-18 §2.3). Its only safety rule is the **cold-embedding** fallback: a
 * `SemanticRetriever.retrieve` that returns `[]` (index empty, or the embedder
 * provider is down) yields `[]` here, which the {@link HybridRetriever} turns
 * into a lexical-only result rather than dropping a real match (day-26 §2.4).
 */

import type { SemanticCandidate } from './semantic-retriever.js';
import type { RetrievedDoc, RetrievalQuery, Retriever } from './retriever.js';

/** The minimal candidate surface `SemanticDocRetriever` composes. */
export interface SemanticCandidateSource {
  retrieve(query: string): Promise<SemanticCandidate[]>;
}

export class SemanticDocRetriever implements Retriever {
  readonly method = 'semantic';

  constructor(private readonly source: SemanticCandidateSource) {}

  async retrieve(query: RetrievalQuery): Promise<RetrievedDoc[]> {
    const contentBySource = new Map(
      query.documents.map((document) => [document.sourceId, document.content]),
    );
    const candidates = await this.source.retrieve(query.text);

    const docs: RetrievedDoc[] = [];
    for (const candidate of candidates) {
      const content = contentBySource.get(candidate.sourceId);
      if (content === undefined) continue; // index row for a source not collected
      docs.push({
        sourceId: candidate.sourceId,
        content,
        score: candidate.similarity,
        matchedBy: 'semantic',
      });
    }
    return docs;
  }
}
