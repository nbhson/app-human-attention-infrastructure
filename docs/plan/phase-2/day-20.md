# Day 20 — Context Cache: `source_id + content_hash`, TTL & Freshness (+ Week 4 Checkpoint)

| | |
|---|---|
| **Week** | 4 — Semantic infra (shadow) |
| **Spec refs** | Spec 4 §5.2.3 (context cache), §8 (freshness / invalidation), §5.2.4 (validation gate) |
| **Estimated effort** | 6 hours |
| **Prerequisites** | Day 19 (exact tokenizer); Day 18 (shadow rank); Day 17 (freshness guard) |

---

## 1. Objectives

By end of day you will have:

1. A **context source cache** keyed by `source_id + content_hash`, per Spec 4 §5.2.3 — a hit reuses parsed content (skipping file read + parse), a hash change is simply a miss (never a poisoned result).
2. **TTL + invalidation** — entries age out on a configurable TTL, and are invalidated on artifact change; freshness is *hash-truth-first*, TTL-second (the hash is the truth; the TTL is a space bound).
3. A **cache-size telemetry** (hit rate, miss rate, entry count) wired into the shadow metrics report so Week 5 can show cache value without a new mechanism.
4. **Week 4 checkpoint verification** — the semantic shadow is demonstrable end-to-end today (pgvector populated, semantic rank logged, default `rank_method` still `keyword`).

Two deliverables in one: the cache is the last W4 feature; the checkpoint confirms the week's whole point — semantic infra installed in shadow, default untouched.

---

## 2. Design Decisions

### 2.1 The cache shape — keys on identity + content

```typescript
// packages/context-engine/src/cache/context-cache.ts
export interface ContextCache {
  get(sourceId: string, contentHash: string): Promise<CachedSource | null>;
  set(sourceId: string, contentHash: string, entry: CachedSource): Promise<void>;
  invalidate(sourceId: string): Promise<void>;
  stats(): Promise<{ hits: number; misses: number; entries: number }>;
}

export interface CachedSource {
  parsed: { content: string; tokenCount: number };   // the expensive-to-recompute artifact
  storedHash: string;                                // equals the key's contentHash
  storedAt: Date;
}
```

Storage is a Postgres table (`context_source_cache`) — the modular-monolith rule (Postgres-centric) still holds; no Redis yet. The key is the composite `(source_id, content_hash)`; content is the *parsed* form (token count already computed, per Day 19).

### 2.2 Freshness — hash is the truth, TTL is the bound

Spec 4 §5.2.3 is explicit: **the hash is the truth; no TTL clock is required.** A changed file has a changed `content_hash`, so a stale entry is a natural miss. The TTL exists only to bound table growth (evict entries unread for N days), never to decide correctness. Invalidation on `artifact.changed` is a write-amplification optimization (free the space early), not a correctness requirement.

### 2.3 The snapshot itself is never cached

`ContextSnapshot` is point-in-time and must reflect what a task actually consumed (for provenance). Only the *source content* is cached. This is a hard line from §5.2.3 — caching the snapshot would break provenance by serving a previous task's resolution as the current one.

### 2.4 Cache is wrong at the wrong layer — no

The cache is a leaf looked up by the *collector* stage, not a wrapper around `resolveContext`. A cache placed around the whole `resolveContext` call would cache ranked orderings and budgets — reintroducing staleness into the most decision-sensitive part. Keep it per-source, read-only.

---

## 3. Tasks

### 3.1 Migration + cache store (60 min)

- [ ] `packages/db/migrations/0113_context_cache.sql` — `context_source_cache(source_id, content_hash, parsed jsonb, storedAt, PK(source_id, content_hash))`.
- [ ] `packages/context-engine/src/cache/context-cache.ts` (§2.1).

### 3.2 Wire into the collector (90 min)

- [ ] `file-collector` looks up the cache before reading + parsing; on miss, reads, parses, computes token count, and `set`s before returning.
- [ ] Prove the *snapshot* is not touched (the collector returns a source; the snapshot assembly is downstream of the cache).

### 3.3 Invalidation + TTL sweep (60 min)

- [ ] Subscribe to `artifact.changed` → `invalidate(source_id)`.
- [ ] A TTL sweep (`cache:sweep --ttl 30d`) evicts entries unread beyond TTL; correctness unaffected (a swept entry is a miss, not a wrong hit).

### 3.4 Telemetry (30 min)

- [ ] `stats()` fed into the shadow metrics report (hit/miss ratio); a `harness_context_cache_hit_total` counter on the Day-04 registry.

### 3.5 Week-4 checkpoint verification (90 min)

- [ ] `scripts/demo/week4-shadow.md`: backfill index → run a task with the shadow flag ON → show `shadow_rank_comparisons` populated and the served snapshot's `rank_method = 'keyword'` → show cache hit on a re-run of an unchanged task.

### 3.6 Tests (90 min)

- [ ] Hit/miss: same `(source_id, content_hash)` → hit (collector skips read, asserted via a counting filesystem stub).
- [ ] Hash-change: new `content_hash` → miss + fresh set (no stale `parsed` returned).
- [ ] Invalidation: `artifact.changed` empties the entry; subsequent get returns null.
- [ ] Snapshot-not-cached: two tasks resolve distinct `ContextSnapshot`s even when the source itself is cache-hit.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/cache/context-cache.ts` | Cache + stats |
| `packages/db/migrations/0113_context_cache.sql` | Cache table |
| `packages/context-engine/src/__tests__/context-cache.test.ts` | Hit/miss/hash/invalidate tests |
| `scripts/demo/week4-shadow.md` | Week-4 shadow + cache demo |
| `docs/retros/week-04.md` | Week-4 retro |

---

## 5. Acceptance Criteria

- [ ] Same `(source_id, content_hash)` → cache hit; the collector performs zero file reads (counting stub asserts).
- [ ] Changed `content_hash` → miss + new entry; a stale `parsed` is never returned.
- [ ] `artifact.changed` invalidates and subsequent `get` returns null.
- [ ] The `ContextSnapshot` is never cached — two resolves produce distinct snapshots over a cache-hit source (test).
- [ ] `harness_context_cache_hit_total` counter increments on hits; `stats()` reports a sane ratio after the demo.
- [ ] Week-4 checkpoint demo shows `shadow_rank_comparisons` populated while the served snapshot's `rank_method === 'keyword'`.
- [ ] `pnpm --filter @harness/context-engine test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **The hash is the truth; the TTL is not a correctness mechanism.** If you ever find code relying on the TTL to decide "this is fresh", you've inverted the design. Freshness is `content_hash` match, always.
- **Do not cache `ContextSnapshot`.** It is the most tempting "optimization" in Context-land and the fastest way to break provenance — a later task must never receive a prior task's resolution. Cache only source content.
- **Cache-hit means "same content", not "still relevant".** The cache has zero opinion about relevance/ranking; those run fresh every time. Don't roads the cache to skip ranking.
- **TTL sweep must not delete on the hot path.** Sweep is a background/offline job; telemetry reads must be cheap. A sweep that's also a hot-path eviction will show up as latency, not freshness.
- **Week-4 checkpoint is the last safe moment to catch shadow leakage.** If `rank_method` has drifted off `keyword` anywhere, today's demo is where it must surface — before Week 5 layers sandbox + object store + cache on top.
- **Next (Day 21):** Week 5 opens — the object store (S3/MinIO) as the `ContentStore` seam for large artifacts (Spec 5 §4.2).

---

*Prev: [Day 19 — Exact Tokenizer](day-19.md) | Next: [Day 21 — Object Store: S3/MinIO `ContentStore`](day-21.md)*