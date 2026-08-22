/**
 * Context source cache (day-20 §2.1) — a read-optimization leaf for the
 * collector: `get` reuses parsed source content on a `(source_id, content_hash)`
 * match; `getByStat` reuses it on a `(source_id, mtime, size)` match so a hit
 * needs zero file reads (§5.1).
 *
 * The hash is the truth; the stat fast-path is a necessary-enough proxy on an
 * immutable-per-content filesystem view (§2.2). The cache stores *source content
 * only* — never a `ContextSnapshot` — so provenance is unaffected (§2.3). Hits
 * and misses are counted in-memory and mirrored onto the Day-04 Prometheus
 * registry (`harness_context_cache_hit_total` / `_miss_total`).
 */

import { count, eq } from 'drizzle-orm';

import { contextSourceCache } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { recordCacheHit, recordCacheMiss } from '@harness/observability';

/** The cached source content + its identity/staleness metadata. */
export interface CachedSource {
  readonly sourceId: string;
  readonly contentHash: string;
  readonly content: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly storedAt: Date;
}

/** Input to {@link ContextCache.set}. */
export interface CacheEntryInput {
  readonly sourceId: string;
  readonly contentHash: string;
  readonly content: string;
  readonly mtimeMs: number;
  readonly size: number;
}

/** Aggregate hit/miss/entry report for the Week-4 shadow metrics (§3.4). */
export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly entries: number;
}

/** The cache seam the collector depends on (day-20 §2.1). */
export interface ContextCache {
  /** Content-addressed lookup — the hash is the truth (§2.2). */
  get(sourceId: string, contentHash: string): Promise<CachedSource | null>;
  /** Stat fast-path: hit only when the stored `(mtime, size)` matches (§5.1). */
  getByStat(sourceId: string, mtimeMs: number, size: number): Promise<CachedSource | null>;
  /** Upsert the current content for a source (one row per `source_id`). */
  set(entry: CacheEntryInput): Promise<void>;
  /** Drop a source's entry (artifact change → free the space early, §2.2). */
  invalidate(sourceId: string): Promise<void>;
  /** Hit/miss/entry counts for telemetry. */
  stats(): Promise<CacheStats>;
}

function toCachedSource(row: typeof contextSourceCache.$inferSelect): CachedSource {
  return {
    sourceId: row.source_id,
    contentHash: row.content_hash,
    content: row.content,
    mtimeMs: row.mtime_ms,
    size: row.size,
    storedAt: row.stored_at,
  };
}

/** Postgres-backed cache (modular-monolith rule: Postgres-centric, no Redis). */
export class PostgresContextCache implements ContextCache {
  private hits = 0;
  private misses = 0;

  constructor(private readonly db: DrizzleDB) {}

  async get(sourceId: string, contentHash: string): Promise<CachedSource | null> {
    const rows = await this.db
      .select()
      .from(contextSourceCache)
      .where(eq(contextSourceCache.content_hash, contentHash))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return this.miss();
    }
    this.hits += 1;
    recordCacheHit();
    return toCachedSource(row);
  }

  async getByStat(sourceId: string, mtimeMs: number, size: number): Promise<CachedSource | null> {
    const rows = await this.db
      .select()
      .from(contextSourceCache)
      .where(eq(contextSourceCache.source_id, sourceId))
      .limit(1);
    const row = rows[0];
    // A source_id plus a mismatched stat is a miss — the on-disk file changed.
    if (!row || row.mtime_ms !== mtimeMs || row.size !== size) {
      return this.miss();
    }
    this.hits += 1;
    recordCacheHit();
    return toCachedSource(row);
  }

  async set(entry: CacheEntryInput): Promise<void> {
    await this.db
      .insert(contextSourceCache)
      .values({
        source_id: entry.sourceId,
        content_hash: entry.contentHash,
        mtime_ms: entry.mtimeMs,
        size: entry.size,
        content: entry.content,
      })
      .onConflictDoUpdate({
        target: contextSourceCache.source_id,
        set: {
          content_hash: entry.contentHash,
          mtime_ms: entry.mtimeMs,
          size: entry.size,
          content: entry.content,
          stored_at: new Date(),
        },
      });
  }

  async invalidate(sourceId: string): Promise<void> {
    await this.db.delete(contextSourceCache).where(eq(contextSourceCache.source_id, sourceId));
  }

  async stats(): Promise<CacheStats> {
    const rows = await this.db.select({ n: count() }).from(contextSourceCache);
    return { hits: this.hits, misses: this.misses, entries: rows[0]?.n ?? 0 };
  }

  private miss(): null {
    this.misses += 1;
    recordCacheMiss();
    return null;
  }
}
