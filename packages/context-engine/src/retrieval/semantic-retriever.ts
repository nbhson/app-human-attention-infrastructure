/**
 * Semantic retriever (day-18 §2.1, §3.1) — cosine similarity over the populated
 * index, behind the Day-16 `Embedder` seam.
 *
 * This is the low-level primitive: given a query, embed it and return every index
 * row that *has* a vector, ordered by cosine similarity to the query. It is
 * deliberately narrow — it neither filters by freshness (it has no notion of the
 * current on-disk content) nor applies the target-file rule; both belong to the
 * {@link SemanticRanker} that wraps it, where the current content is known.
 *
 * A provider outage degrades to an empty result (the `Embedder` returns a typed
 * error, never throws — day-16 §2.2), so the shadow path simply records "no
 * semantic ranking" rather than failing the live keyword resolution.
 */

import { contextSourceEmbeddings } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { Embedder } from '@harness/embeddings';

/** One ranked neighbour: the stored row plus its cosine similarity to the query. */
export interface SemanticCandidate {
  readonly sourceId: string;
  /** The content hash the stored vector was computed FROM (day-17 §2.4). */
  readonly contentHash: string;
  readonly embedding: readonly number[];
  /** Cosine similarity in [-1, 1] against the query vector. */
  readonly similarity: number;
}

/** Cosine similarity between two equal-width vectors; 0 when either is empty. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

export class SemanticRetriever {
  constructor(
    private readonly db: DrizzleDB,
    private readonly embedder: Embedder,
  ) {}

  /** Embed `query` and return all populated candidates, best-match first. */
  async retrieve(query: string): Promise<SemanticCandidate[]> {
    const queryResult = await this.embedder.embedQuery(query);
    if (!queryResult.ok) {
      return []; // provider down → the shadow path degrades to an empty ranking
    }
    const queryVector = queryResult.vector;

    const rows = await this.db
      .select({
        sourceId: contextSourceEmbeddings.source_id,
        contentHash: contextSourceEmbeddings.content_hash,
        embedding: contextSourceEmbeddings.embedding,
      })
      .from(contextSourceEmbeddings);

    const candidates: SemanticCandidate[] = [];
    for (const row of rows) {
      if (row.embedding === null) continue; // pending row — never servable
      candidates.push({
        sourceId: row.sourceId,
        contentHash: row.contentHash,
        embedding: row.embedding,
        similarity: cosineSimilarity(queryVector, row.embedding),
      });
    }
    return candidates.sort((a, b) => b.similarity - a.similarity);
  }
}
