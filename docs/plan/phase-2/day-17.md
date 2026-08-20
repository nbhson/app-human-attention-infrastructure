# Day 17 — Index Population: Embed Sources/Artifacts, Re-embed on Change

| | |
|---|---|
| **Week** | 4 — Semantic infra (shadow) |
| **Spec refs** | Spec 4 §5.1 (index boundary / `ContextSource.type` shard), Spec 5 §4.1 (what to track) + §2.1 (`content_hash`), Spec 2 §8 (artifact events) |
| **Estimated effort** | 7 hours |
| **Prerequisites** | Day 16 (pgvector + `Embedder` + stub/adapter); Phase-1 `artifact.created`/`artifact.changed` events + `content_hash` |

---

## 1. Objectives

By end of day you will have:

1. An **index-population job** that embeds existing `context_sources` and artifacts into the Day-16 vector column (batch, resumable, idempotent).
2. A **re-embed on artifact change** listener — when `artifact.created`/`artifact.changed` fires, the affected source is re-embedded, keyed by `content_hash` (stale vectors are never queried).
3. **Freshness by hash** — a vector is only valid if its `content_hash` matches the current content; a changed artifact is a cache miss until re-embedded, never a stale-but-served result.
4. **Population telemetry** — count embedded, pending, and stale rows so the operator can see index completeness at a glance (feeds Week 5's shadow metrics).

The index is useless if it's empty or stale. Today is what makes Week 4's semantic shadow *measureable* against real content — but still never the default.

---

## 2. Design Decisions

### 2.1 What gets embedded — source text, not raw blobs

Embedding input is the `context_sources.content` (and a normalized artifact snippet), not the raw file bytes. **Why:** `content` already went through Phase-1 normalization (binary files excluded, secrets not logged), so embedding it reuses the existing safety boundary. Embedded text is truncated to the provider's token window (use the spec's `max_tokens_per_source` as the cap) with the truncation recorded.

### 2.2 Population is batch, resumable, idempotent

```typescript
// packages/embeddings/src/indexer.ts
export interface IndexPopulation {
  run(batchSize: number, onProgress: (p: Progress) => void): Promise<void>;
}

interface Progress { total: number; embedded: number; failed: number; stale: number; }
```

- **Resumable:** each row's embedding is written transactionally with its `embedded_at` + source `content_hash`; a crashed run picks up where it left off (rows without a matching `content_hash` are "pending").
- **Idempotent:** re-running over already-embedded rows is a no-op (hash matches → skip). This is what makes the job safe to run on a schedule and again after a crash.
- **Backpressure** respects the provider's rate limit (the adapter's retry from Day 16 handles transient 429s; the indexer backs off rather than hammering).

### 2.3 Re-embed is event-driven, keyed on `content_hash`

```text
artifact.created / artifact.changed
   → resolve the affected ContextSource(source_id)
   → if current.content_hash != stored.embedding_hash: mark stale, re-embed, update hash
   → else: no-op (hash unchanged)
```

The listener publishes nothing new (embedding is internal infra); it only mutates the vector + hash. A regenerate event on a *deleted* source marks it stale (embedding dropped logically) — vectors are never left pointing at gone content.

### 2.4 Staleness is a query-time guard, not a background promise

Even with the listener, a vector can be momentarily stale (a change lands between the event and the re-embed). The **read path** (Day 18's retriever) therefore joins on `embedding_hash = content_hash` — a mismatch means "don't serve this vector". Staleness is handled at read, corrected at write; together they make the index eventually-consistent without ever returning a poisoned neighbor.

---

## 3. Tasks

### 3.1 Indexer core (120 min)

- [ ] `packages/embeddings/src/indexer.ts` — §2.2 run loop: select pending rows, embed in batches, write vector + `embedding_hash` + `embedded_at`.
- [ ] Add `embedding_hash` / `embedded_at` columns (migration `0111_index_meta.sql`) to track which version a vector corresponds to.

### 3.2 The backfill CLI (60 min)

- [ ] `pnpm embed:populate --batch 64` — one-shot/backfill entry; prints `Progress` at the end.

### 3.3 Re-embed listener (90 min)

- [ ] `packages/embeddings/src/reembed-listener.ts` — subscribe to `artifact.created`/`artifact.changed` (via `IEventBus`), apply §2.3.
- [ ] Register in `bootstrap.ts`; assert it subscribes but takes no action on hash-unchanged events.

### 3.4 Staleness + telemetry (60 min)

- [ ] A `GetIndexHealth()` query: `embedded / pending / stale` counts (feeds Week 5 report).
- [ ] Read-path guard helper `isFreshVector(row)` — `embedding_hash === content_hash`.

### 3.5 Tests (90 min)

- [ ] Resumability: run populate, kill mid-batch (simulate), re-run → only pending rows embedded; no double-embed of completed rows.
- [ ] Idempotency: two consecutive runs → second performs zero embeds.
- [ ] Re-embed: change a source's `content_hash` → listener re-embeds; unchanged `content_hash` → no-op.
- [ ] Staleness: a row whose hash mismatch is excluded by the freshness guard.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/embeddings/src/indexer.ts` | Batch/resumable/idempotent population |
| `packages/embeddings/src/reembed-listener.ts` | Artifact-change re-embed |
| `packages/embeddings/src/health.ts` | `GetIndexHealth` + freshness guard |
| `packages/db/migrations/0111_index_meta.sql` | `embedding_hash` + `embedded_at` |
| `packages/embeddings/src/__tests__/indexer.test.ts` | §3.5 matrix |

---

## 5. Acceptance Criteria

- [ ] `pnpm embed:populate --batch 64` fills the vector column for seeded sources; `GetIndexHealth` reports `stale == 0` after a clean run.
- [ ] Re-running populate is a no-op (second run performs zero `embed` calls — counting stub asserts it).
- [ ] A simulated mid-batch crash resumed correctly: only pending rows are embedded on the second run.
- [ ] `artifact.changed` with a new `content_hash` triggers re-embed; an unchanged hash triggers nothing.
- [ ] A row with `embedding_hash != content_hash` is excluded by `isFreshVector` (freshness guard).
- [ ] The re-embed listener emits **no** new harness events (it mutates index state only) — asserted.
- [ ] `pnpm --filter @harness/embeddings test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Embedding drift is the silent killer.** If a file changes and its vector isn't re-embedded, the index serves a *reasonable-looking but wrong* neighbor forever. The `embedding_hash`/`content_hash` join is the only thing standing between "shadow mode" and "shadow mode that quietly poisons its own measurements."
- **Re-embed is keyed on the event's artifact, but mapped through the source.** Don't re-embed the artifact blob directly — resolve the `source_id` it belongs to, or you'll build a second identity for the same content.
- **Truncate before embedding, and record it.** Embedding a source over the provider's window either errors or silently truncates server-side. Truncate locally, store the truncation, so a short vector isn't later mistaken for a wrong one.
- **Backpressure the provider.** A 50k-row backfill that hammers an embeddings endpoint is a rate-limit incident. The indexer's batch pacing + the adapter's retry are one mechanism, not two.
- **Population telemetry is a shadow metric, not a dashboard decoration.** `embedded/pending/stale` feeds Day 25's report and the A/B harness's "is the semantic variant even a fair comparison" check. If the index is 60% stale, the semantic-vs-keyword comparison is meaningless — the report must say so.
- **Next (Day 18):** the semantic retriever behind the `Retriever`/`Ranker` seam, in shadow — logged, measured, never the default `rank_method`.

---

*Prev: [Day 16 — pgvector Migration, `Embedder` Interface & Provider Adapter](day-16.md) | Next: [Day 18 — Semantic Retriever in Shadow, Behind the `Retriever`/`Ranker` Seam](day-18.md)*
