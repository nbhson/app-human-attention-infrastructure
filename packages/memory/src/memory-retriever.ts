/**
 * `MemoryRetriever` (review-reorient Phase 3, day-18 §2.1 §3.1) — the read half
 * of review memory: recall topical entries for a query and rank them by
 * relevance, so the *next* review's context carries the distilled past.
 *
 * The rank is a deterministic linear mix of four terms, each in `[0, 1]`:
 *
 *   relevance = wLex·lexicalMatch + wConf·confidence + wRec·recency + wPop·popularity
 *
 * - **lexical** — token-coverage of the query over the entry content (recall).
 * - **confidence** — the entry's own `confidence` (day-17) as a fraction.
 * - **recency** — exponential decay on age (a fresh-but-cold entry stays
 *   beatable by a barely-colder, high-confidence one).
 * - **popularity** — `retrievedCount` (stale-but-popular vs fresh-but-cold).
 *
 * It returns only the **head of each version chain** (day-18 §2.2) and bumps the
 * access counters fire-and-forget after the result is built (day-18 §2.4), so the
 * read path never blocks on the write. No `@harness/context-engine` import — the
 * engine reaches this through the `@harness/domain` `MemoryProvider` seam.
 */

import type { Logger } from '@harness/di';
import type { MemoryEntry, MemoryKind, MemoryProvider, MemoryQuery } from '@harness/domain';
import type { MemoryRetrievalResult } from '@harness/domain';

import { resolveChainHeads } from './chain-resolve.js';
import type { MemoryStore } from './memory-store.js';

/** The four tiers a query defaults to spanning when none are named. */
const ALL_KINDS: readonly MemoryKind[] = ['REVIEW', 'FINDING', 'DECISION', 'PROJECT'];

/** Term weights (sum to 1). */
const LEXICAL_WEIGHT = 0.5;
const CONFIDENCE_WEIGHT = 0.2;
const RECENCY_WEIGHT = 0.2;
const POPULARITY_WEIGHT = 0.1;

/** Age (days) at which recency decays to 1/e. */
const RECENCY_HALFLIFE_DAYS = 30;
/** `retrievedCount` at which the popularity term saturates at 1. */
const POPULARITY_SATURATION = 10;

/** Default top-K when the caller leaves `limit` unset. */
const DEFAULT_LIMIT = 10;

/** Lowercase alphanumeric token stream (no stopword list — the query is small). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Fraction of query tokens present in `content` (lexical recall in `[0,1]`). */
function lexicalMatch(queryText: string, content: string): number {
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) {
    return 0;
  }
  const contentTokens = new Set(tokenize(content));
  let hits = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
}

/** Exponential decay on age: 1.0 now, `1/e` after the half-life. */
function recency(createdAt: Date, now: Date): number {
  const ageDays = (now.getTime() - createdAt.getTime()) / 86_400_000;
  return Math.exp(-ageDays / RECENCY_HALFLIFE_DAYS);
}

/** Linear popularity on `retrievedCount`, 0 → 1 at saturation. */
function popularity(retrievedCount: number): number {
  return Math.min(retrievedCount / POPULARITY_SATURATION, 1);
}

export class MemoryRetriever implements MemoryProvider {
  constructor(
    private readonly store: MemoryStore,
    // Injectable clock so ranking stays deterministic under test.
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: Logger,
  ) {}

  async retrieve(query: MemoryQuery): Promise<readonly MemoryRetrievalResult[]> {
    const kinds = query.kinds && query.kinds.length > 0 ? query.kinds : ALL_KINDS;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const now = this.now();

    const heads = resolveChainHeads((await Promise.all(kinds.map((kind) => this.store.listByKind(kind)))).flat());

    const results = heads.map((entry) => ({
      entry,
      relevance: this.score(entry, query.text, now),
    }));
    results.sort((a, b) => b.relevance - a.relevance);
    const topK = results.slice(0, limit);

    // Day 18 §2.4: track access after serving — never on the hot path.
    for (const { entry } of topK) {
      void this.store.recordAccess(entry.id).catch((error: unknown) => {
        this.logger?.debug('memory: access tracking failed', {
          memory_id: entry.id,
          error: String(error),
        });
      });
    }

    return topK;
  }

  private score(entry: MemoryEntry, queryText: string, now: Date): number {
    return (
      LEXICAL_WEIGHT * lexicalMatch(queryText, entry.content) +
      CONFIDENCE_WEIGHT * (entry.confidence / 100) +
      RECENCY_WEIGHT * recency(entry.createdAt, now) +
      POPULARITY_WEIGHT * popularity(entry.retrievedCount)
    );
  }
}
