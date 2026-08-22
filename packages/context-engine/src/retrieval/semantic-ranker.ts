/**
 * Semantic ranker (day-18 §2.3, §3.2) — an *async* ranking seam that turns the raw
 * task text into a vector and orders the collected files by cosine similarity.
 *
 * It deliberately does NOT implement the synchronous {@link Ranker} interface from
 * day-20: that seam receives tokenized *keywords*, not the raw query text the
 * embedder needs, so semantic ranking has to be a new seam. The keyword ranker
 * remains the default; this class only runs when the caller explicitly opts into
 * the shadow comparison (day-18 §2.3 — served order stays keyword).
 *
 * Two rules live here, not in the retriever, because they need the *current*
 * content that only the collection pass has:
 *
 * - **Freshness** (day-17 §2.4): a stored vector is usable only when its
 *   `content_hash` equals the SHA-256 of the file *just collected*. A stale row
 *   (edited since embed) is dropped from the semantic order.
 * - **Target files are never dropped**: even with no fresh vector, every target
 *   file appears in the semantic order at `relevanceScore: -1`, so both orderings
 *   share their targets for the Day-29 A/B comparison.
 */

import type { DrizzleDB } from '@harness/db';
import type { Embedder } from '@harness/embeddings';

import type { CollectedFile } from '../collect.js';
import { sha256 } from '../freshness.js';
import type { RankedFile } from '../rank.js';
import { SemanticRetriever } from './semantic-retriever.js';

/** Bottom-of-rank marker: no usable vector, but the file must stay in the order. */
const NO_SIGNAL = -1;

export class SemanticRanker {
  private readonly retriever: SemanticRetriever;

  constructor(
    private readonly db: DrizzleDB,
    private readonly embedder: Embedder,
    retriever?: SemanticRetriever,
  ) {
    this.retriever = retriever ?? new SemanticRetriever(db, embedder);
  }

  /**
   * Rank `files` by cosine similarity to `query`, shadow-only.
   *
   * Returns every `file` that has a fresh vector (best-first), then any target
   * file that lacked one, at `relevanceScore: -1`. Files without a fresh vector —
   * and that are not targets — are absent, since semantic ranking has no signal
   * for them.
   */
  async rank(
    query: string,
    targetFiles: readonly string[],
    files: readonly CollectedFile[],
  ): Promise<RankedFile[]> {
    const fileBySource = new Map(files.map((file) => [file.sourceId, file]));

    // Current content hash per source — the only basis for the freshness guard.
    const currentHashes = new Map(files.map((file) => [file.sourceId, sha256(file.content)]));

    const candidates = await this.retriever.retrieve(query);

    const ranked: RankedFile[] = [];
    const rankedSources = new Set<string>();
    for (const candidate of candidates) {
      const file = fileBySource.get(candidate.sourceId);
      if (!file) continue; // an index row for a source not in this collection
      if (candidate.contentHash !== currentHashes.get(candidate.sourceId)) continue; // stale
      ranked.push({
        sourceId: candidate.sourceId,
        content: file.content,
        relevanceScore: candidate.similarity,
      });
      rankedSources.add(candidate.sourceId);
    }

    // Targets must never vanish from the semantic order, even without a signal.
    for (const target of targetFiles) {
      if (rankedSources.has(target)) continue;
      const file = fileBySource.get(target);
      if (!file) continue; // a target that collection did not produce
      ranked.push({ sourceId: target, content: file.content, relevanceScore: NO_SIGNAL });
    }

    return ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
}
