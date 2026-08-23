/**
 * Hybrid retriever (day-26 §2.1, §2.2) — lexical + semantic, fused.
 *
 * It composes two {@link Retriever}s (the lexical `keyword` ranker and the
 * semantic cosine ranker) and runs them **concurrently** via `Promise.all`, so
 * latency is the slower single retriever, not the sum (day-26 §2.1). The two
 * rankings are then fused by {@link reciprocalRankFusion} — rank-based, so the
 * incompatible keyword/cosine scales never meet — and deduplicated by sourceId.
 *
 * A sourceId that both layers returned is reported as `matchedBy: 'both'` and is
 * one stronger candidate, not two (day-26 §6). The **cold-embedding** rule
 * (day-26 §2.4) falls out of the fusion for free: if the semantic layer is
 * empty, RRF only sees the lexical ranking, so every result is lexical — a
 * missing embedding never zeroes out a real lexical match.
 */

import type { RetrievedDoc, Retriever, RetrievalQuery } from './retriever.js';
import { reciprocalRankFusion } from './rrf.js';

export class HybridRetriever implements Retriever {
  readonly method = 'hybrid';

  constructor(
    private readonly lexical: Retriever,
    private readonly semantic: Retriever,
  ) {}

  async retrieve(query: RetrievalQuery): Promise<RetrievedDoc[]> {
    // Concurrent fetch: latency ≈ the slower layer, not the sum.
    const [lexicalDocs, semanticDocs] = await Promise.all([
      this.lexical.retrieve(query),
      this.semantic.retrieve(query),
    ]);

    const fused = reciprocalRankFusion([
      lexicalDocs.map((doc) => doc.sourceId),
      semanticDocs.map((doc) => doc.sourceId),
    ]);

    const lexicalSources = new Set(lexicalDocs.map((doc) => doc.sourceId));
    const semanticSources = new Set(semanticDocs.map((doc) => doc.sourceId));

    // Content is identical from either layer for the same sourceId; prefer the
    // lexical copy so the default ranking's content wins on the rare mismatch.
    const contentBySource = new Map(semanticDocs.map((doc) => [doc.sourceId, doc.content]));
    for (const doc of lexicalDocs) {
      contentBySource.set(doc.sourceId, doc.content);
    }

    return fused.map((entry) => {
      const inLex = lexicalSources.has(entry.sourceId);
      const inSem = semanticSources.has(entry.sourceId);
      return {
        sourceId: entry.sourceId,
        content: contentBySource.get(entry.sourceId) ?? '',
        score: entry.score,
        matchedBy: inLex && inSem ? 'both' : inLex ? 'lexical' : 'semantic',
      };
    });
  }
}
