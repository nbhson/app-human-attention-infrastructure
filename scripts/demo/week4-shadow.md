# Week 4 Live Demo — Semantic Shadow & Context Cache

*Phase 2 · day-20 checkpoint. A narrated runbook: confirm the semantic index
backfills, watch the cache serve a hit with zero file reads, and re-confirm the
week's single honest invariant — the **served** context is still keyword-ranked
(`rank_method = 'keyword'`) while the semantic ordering is recorded in shadow,
never served. The cache numbers below are the real counters the Day-04 registry
exposes; the shadow comparison is asserted by the same tests that make the
invariant mechanical.*

> Week 4 is the "installed in shadow" week. The deliverable is **not** a switched
> ranking — it is proof that the semantic path exists, is measured, and does not
> leak. The honest instrument of that proof is the Day-18 shadow-negative test and
> the Week-4 checkpoint queries below, not a live semantic switch.

---

## 0. Prereqs & clean stack

```bash
docker compose down -v
docker compose up -d          # wait for postgres healthy

pnpm db:migrate               # applies migrations through 0026 (context_source_cache)
pnpm seed:metrics-checkpoint  # prime a decidable review window (used by earlier weeks)
pnpm dev                      # API on http://localhost:3000 for §3
```

Watch the cache counters appear on the registry (they are live even before any
hit, because the Day-20 counters are registered at boot):

```bash
curl -s http://localhost:3000/metrics | grep -E 'harness_context_cache_(hit|miss)_total'
#   harness_context_cache_hit_total 0
#   harness_context_cache_miss_total 0
```

---

## 1. The semantic index backfills — `pnpm embed:populate`

The Day-17 backfill reads the *existing* persisted `contexts.sources` (already
safety-filtered by the collector) and (re)builds the pgvector index. It is the
out-of-band population job the shadow ranker reads from:

```bash
pnpm embed:populate
```

This is resumable and idempotent — re-running it re-embeds over `content_hash`
and leaves the read path's freshness guard (day-17 §2.4) as the only thing that
can drop a stale vector.

---

## 2. The cache serves a hit with zero reads

The cache keys on `source_id + content_hash`, but the **hash is the truth** and a
`(mtime, size)` stat fast-path is what lets a hit skip the file open (§5.1). The
proof that a hit performs zero reads is the `chmod 000` test — the collector
still returns the cached content from a file it can no longer read:

```text
packages/context-engine/src/__tests__/context-cache.test.ts
  ✓ serves a hit with zero file reads (chmod 000 still collects)
  ✓ re-reads when the file changed (stale stat → miss → fresh content)
  ✓ caches source content only — never a serialised snapshot
```

The table a hit and a miss land in:

```bash
psql "$DATABASE_URL" -c "SELECT source_id, content_hash, mtime_ms, size, stored_at
                          FROM context_source_cache ORDER BY stored_at DESC LIMIT 5;"
```

- `source_id` is the repo-relative path; `content_hash` is the SHA-256 of the
  collected content (the truth).
- `mtime_ms` + `size` are the stat fast-path discriminator.
- `content` is the raw source text — **not** a serialised `ContextSnapshot`
  (§2.3: the snapshot is never cached; only source content is).

Invalidation is a side effect on the cache: `artifact.created` (inline
`file_path`) and `artifact.changed` (resolves `artifact_id` → `file_path` via
`artifacts`) both `invalidate`, so a rewrite is never served off the stat path:

```text
packages/context-engine/src/__tests__/cache-invalidating-listener.test.ts
  ✓ onCreated invalidates by the inline file_path
  ✓ onChanged resolves artifact_id → file_path and invalidates
```

---

## 3. The invariant — keyword served, semantic shadowed

The Week-4 checkpoint query. Any task's persisted context must still report the
keyword `rank_method` and the exact tokenizer, regardless of the shadow:

```bash
psql "$DATABASE_URL" -c "SELECT task_id, rank_method, metadata->>'tokenizer' AS tokenizer,
                                total_tokens, jsonb_array_length(sources) AS sources
                         FROM contexts ORDER BY created_at DESC LIMIT 5;"
```

Expected read: `rank_method = 'phase1-keyword-dependency'`, `tokenizer =
'tiktoken:cl100k_base'` (Day 19), a non-synthesized `total_tokens`, and `sources`
only the safety-filtered files — never `node_modules`, never a serialized snapshot.

The shadow comparison is produced **only** by the opt-in `resolveWithShadow`
path — the `COLLECT_CONTEXT` step handler calls `resolveContext` (keyword), so the
semantic ordering reaches `shadow_rank_comparisons` and nothing on the live path
(day-18 §2.3). The populated case is asserted mechanically:

```text
packages/context-engine/src/__tests__/semantic-shadow.test.ts
  ✓ serves keyword rank_method AND records the comparison when the flag is ON
  ✓ is inert by default — zero embed calls and no comparison row (flag OFF)
```

`shadow_rank_comparisons` records both orderings plus a pre-computed Kendall tau
so Day 29's A/B harness can read disagreement before any live switch:

```bash
psql "$DATABASE_URL" -c "SELECT task_id, top_k, rank_correlation,
                                jsonb_array_length(keyword_order) AS k,
                                jsonb_array_length(semantic_order) AS s
                         FROM shadow_rank_comparisons ORDER BY created_at DESC LIMIT 5;"
```

If `rank_method` has drifted off `keyword` anywhere, **this** is the last safe
week to catch it — before Week 5 stacks the object store and sandboxes on top
(day-20 §6).

---

## Green gate before you leave Week 4

```bash
pnpm lint && pnpm -r typecheck && pnpm -r test
```