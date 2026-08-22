/**
 * EmbeddingIndexer (day-17 §2.2) — batch, resumable, idempotent population.
 *
 * The whole semantic index is shadow infrastructure: nothing here runs on the
 * default keyword `rank_method` path, and a failing provider degrades to a
 * logged no-op (the {@link Embedder} returns a typed error, never throws). A
 * source's vector is written with its `content_hash` so the Day-18 read path can
 * join `content_hash === current` and never serve a stale neighbour (day-17 §2.4).
 */

import { inArray, isNotNull } from 'drizzle-orm';

import { contextSourceEmbeddings } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { ContextSourceType, uuidv7 } from '@harness/domain';

import type { Embedder } from './embedder.js';
import type { IndexLogger } from './logger.js';

/** A source ready for embedding: identity + current content. */
export interface SourceCandidate {
  readonly sourceId: string;
  readonly sourceType: ContextSourceType;
  readonly contentHash: string;
  readonly content: string;
}

/** What one population run did (day-17 §2.2). */
export interface Progress {
  /** Distinct sources considered. */
  readonly total: number;
  /** Vectors written this run (first-time or re-embed). */
  readonly embedded: number;
  /** Sources whose embed call failed, left pending for a later run. */
  readonly failed: number;
  /** Sources that were stale (vector from an older version) and got re-embedded. */
  readonly stale: number;
}

export interface IndexerOptions {
  /**
   * Token budget per source. Content past ~4 chars/token is truncated locally
   * before embedding and the cut is recorded on the row (day-17 §6), so a short
   * vector is never mistaken for a wrong one.
   */
  readonly maxTokensPerSource?: number;
}

const DEFAULT_MAX_TOKENS_PER_SOURCE = 2000;
/** Approx chars-per-token until the day-19 exact tokenizer replaces it. */
const CHARS_PER_TOKEN = 4;

/** Truncate `content` to `maxTokens`' approximate char budget and report the cut. */
export function truncateSource(
  content: string,
  maxTokens: number,
): { text: string; truncated: number } {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (content.length <= maxChars) {
    return { text: content, truncated: 0 };
  }
  return { text: content.slice(0, maxChars), truncated: content.length - maxChars };
}

export class EmbeddingIndexer {
  constructor(
    private readonly db: DrizzleDB,
    private readonly embedder: Embedder,
    private readonly opts: IndexerOptions = {},
    private readonly logger?: IndexLogger,
  ) {}

  /**
   * Seed pending rows for any source that isn't fresh, then embed the pending
   * batch. Already-fresh sources are skipped (idempotent), and a failure leaves
   * the row pending so a re-run resumes exactly where this one left off.
   */
  async run(
    sources: readonly SourceCandidate[],
    batchSize: number,
    onProgress?: (progress: Progress) => void,
  ): Promise<Progress> {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError(`batchSize must be a positive integer, got ${batchSize}`);
    }
    const total = sources.length;
    if (total === 0) {
      return { total: 0, embedded: 0, failed: 0, stale: 0 };
    }

    const maxTokens = this.opts.maxTokensPerSource ?? DEFAULT_MAX_TOKENS_PER_SOURCE;

    // Phase 1 — load existing rows once, seed pending rows for non-fresh sources.
    const existing = await this.db
      .select({
        sourceId: contextSourceEmbeddings.source_id,
        contentHash: contextSourceEmbeddings.content_hash,
        embedded: isNotNull(contextSourceEmbeddings.embedding),
      })
      .from(contextSourceEmbeddings)
      .where(
        inArray(
          contextSourceEmbeddings.source_id,
          sources.map((source) => source.sourceId),
        ),
      );
    const byId = new Map(existing.map((row) => [row.sourceId, row]));

    const toEmbed: SourceCandidate[] = [];
    let stale = 0;
    for (const source of sources) {
      const row = byId.get(source.sourceId);
      if (row !== undefined) {
        const fresh = row.embedded && row.contentHash === source.contentHash;
        if (fresh) {
          continue; // idempotent no-op (day-17 §2.2)
        }
        if (row.embedded) {
          stale += 1; // had a vector, but from a different content version
        }
      }
      await this.markPending(source);
      toEmbed.push(source);
    }

    // Phase 2 — embed pending sources in batches.
    let embedded = 0;
    let failed = 0;
    const progress = (): Progress => ({ total, embedded, failed, stale });

    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      const truncated = batch.map((source) => truncateSource(source.content, maxTokens));
      const result = await this.embedder.embed(truncated.map((entry) => entry.text));
      if (!result.ok) {
        failed += batch.length;
        this.logger?.warn('semantic index: embed batch failed (rows left pending)', {
          error: result.error.message,
          retryable: result.error.retryable,
          count: batch.length,
        });
        onProgress?.(progress());
        continue; // rows stay pending; a later run resumes them
      }
      for (let j = 0; j < batch.length; j += 1) {
        const source = batch[j]!;
        const vector = result.vectors[j]!;
        await this.markEmbedded(source, vector, truncated[j]!.truncated);
        embedded += 1;
      }
      onProgress?.(progress());
    }

    return progress();
  }

  /** Seed (or reset) a source's row to the pending state: a hash but no vector. */
  private async markPending(source: SourceCandidate): Promise<void> {
    await this.db
      .insert(contextSourceEmbeddings)
      .values({
        id: uuidv7(),
        source_id: source.sourceId,
        source_type: source.sourceType,
        content_hash: source.contentHash,
        embedding: null,
        model: null,
        dimensions: null,
        truncated_chars: 0,
        embedded_at: null,
      })
      .onConflictDoUpdate({
        target: contextSourceEmbeddings.source_id,
        set: {
          source_type: source.sourceType,
          content_hash: source.contentHash,
          embedding: null,
          model: null,
          dimensions: null,
          truncated_chars: 0,
          embedded_at: null,
        },
      });
  }

  /** Write the computed vector (and its provenance) onto the source's row. */
  private async markEmbedded(
    source: SourceCandidate,
    vector: number[],
    truncatedChars: number,
  ): Promise<void> {
    await this.db
      .insert(contextSourceEmbeddings)
      .values({
        id: uuidv7(),
        source_id: source.sourceId,
        source_type: source.sourceType,
        content_hash: source.contentHash,
        embedding: vector,
        model: this.embedder.model,
        dimensions: this.embedder.dimensions,
        truncated_chars: truncatedChars,
        embedded_at: new Date(),
      })
      .onConflictDoUpdate({
        target: contextSourceEmbeddings.source_id,
        set: {
          source_type: source.sourceType,
          content_hash: source.contentHash,
          embedding: vector,
          model: this.embedder.model,
          dimensions: this.embedder.dimensions,
          truncated_chars: truncatedChars,
          embedded_at: new Date(),
        },
      });
  }
}
