# Phase 2 · Week 4 Retro — Semantic infra, installed in shadow

_Day-20 checkpoint (Phase 2). Fourth pass, over the semantic substrate built across
Phase-2 days 16–20. Same rule as prior retros: honest by design, numbers-first,
blameless — and every acceptance criterion is green before this note is committed.
This week's verdict is structural rather than a single red/green number: the
semantic path exists, is measured, and does not leak into the default — the proof
is a mechanical invariant, not an assertion._

## What shipped this week

- **Day 16 — pgvector + `Embedder` seam.** A `vector(1536)` column and an
  `Embedder` interface with a `StubEmbedder` default and an OpenAI-compatible
  adapter behind an env flag.
- **Day 17 — index + re-embed.** `EmbeddingIndexer` (batch, resumable,
  idempotent) populated out-of-band by `embed:populate`, plus a `ReembedListener`
  that re-embeds the affected file on `artifact.created`/`artifact.changed`, keyed
  on `content_hash` (a stale hash leaves the old row unserved).
- **Day 18 — semantic retriever in shadow.** `SemanticRetriever` (cosine over the
  index) and `SemanticRanker` (freshness guard + target-file rule), reachable only
  through `resolveWithShadow` — the opt-in path that records a
  `shadow_rank_comparisons` row while the served snapshot stays keyword.
- **Day 19 — exact tokenizer.** `TiktokenTokenizer` behind the `Tokenizer` seam
  replaces the Phase-1 `chars/4` approximation; budgets are now counted and
  truncated in the model's own unit, with UTF-8-safe truncation.
- **Day 20 — context source cache.** A Postgres-backed leaf keyed by
  `source_id + content_hash`, with the hash as the truth and a `(mtime, size)`
  stat fast-path for zero-read hits; `artifact.changed` invalidates; the snapshot
  is never cached.

## The checkpoint invariant, and the numbers that hold it up

The one thing Week 4 must prove is that **the served context is still
keyword-ranked while the semantic order is recorded in shadow** — no leakage onto
the default path. That is held by two tests, not by hope:

- `semantic-shadow.test.ts` — "serves keyword `rank_method` AND records the
  comparison when the flag is ON", and "is inert by default — zero embed calls
  and no comparison row (flag OFF)". The shadow-negative test spies on `embedQuery`
  and asserts **zero** calls on the default path.
- `context-cache.test.ts` — "serves a hit with zero file reads (`chmod 000` still
  collects)"; "re-reads when the file changed"; "caches source content only —
  never a serialised snapshot".

The read I take from that: it is the first week where the strongest evidence for
the deliverable is a **negative** — the semantic path is proven by the calls it
does _not_ make on the live path rather than by a number it produced. That is the
correct evidence for a "shadow" week, and it should not be upgraded to a green
"semantic is better" claim until Day 29's A/B dry-run actually measures a
difference.

## What the cache numbers say

The cache introduced two mirror counters on the Day-04 registry
(`harness_context_cache_hit_total` / `_miss_total`) and a `stats()` aggregate
(hits, misses, entries). On a freshly seeded dev DB these sit at zero until a task
runs and a second collect hits — the honest property is not the head-line ratio
but the mechanism: a hit is a **zero-read** serve, proven by the chmod-000 test,
and a stale `(mtime, size)` is a miss that re-reads and re-hashes rather than a
poisoned hit. The `get(sourceId, contentHash)` path is content-addressed and
authoritatively correct regardless of stat drift.

## What is still missing (and Week 5 must not paper over it)

- **The A/B seam is built but still unread.** `shadow_rank_comparisons` has the
  pre-computed Kendall tau between keyword and semantic orders, and nothing has
  _consumed_ it. Day 29 is the first honest read of whether semantic ranking
  actually differs — before then, any "semantic helps" claim is a feature
  announcement, not a measurement.
- **The cache has no TTL sweep.** `stored_at` is the eviction basis and the hash
  is the truth, so correctness never depends on a sweep (§2.2). But the space
  bound is theoretical until a background job evicts entries unread for N days.
  This is a bounded-table-growth task, not a correctness task — and it must stay
  off the hot path when it lands.
- **`resolveWithShadow` is not wired into any HTTP path.** The
  `COLLECT_CONTEXT` step handler calls `resolveContext` (keyword), so the shadow
  today is exercised by the test suite, not by a live endpoint. That is by design
  (read-only shadow), but it means "populated in prod" is not yet demonstrable
  end-to-end outside tests.

## What is fragile

- **The stat fast-path trusts `(mtime, size)` as identity.** It is necessary for
  the zero-read guarantee (you cannot know the hash without reading), but a
  rewrite that preserves both is invisible to it. Correctness leans on the
  invalidation listener dropping the row on `artifact.changed`, and on the
  `get(sourceId, contentHash)` path being content-addressed. Anyone tempted to
  weaken the listener "because stat is good enough" would be reintroducing a
  stale-serve window that only the hash path can close.
- **The exact tokenizer is reference-grade, not re-validated.** Day 19 ships
  js-tiktoken's rank tables unchanged and validates _behaviour_ (gold corpus +
  UTF-8 backoff), not the encoder itself. A model whose encoding js-tiktoken
  doesn't know falls back to `cl100k_base` via `getTokenizer` — a silent
  approximation for Claude-model ids. It is the right default, but it is a
  fallback, and a caller who assumes every model gets an exact count will be
  wrong for the models not in the table.

## Boundary check

- **No engine reached for another engine.** `context-engine` grew dependencies on
  `db`, `di`, `event-bus`, and `observability` this week — all shared infra, and
  all permitted by the boundary matrix (`context-engine` → `[...SHARED,
'observability', 'embeddings']`). The architecture test (R4/R8) is green:
  R4 re-reads each engine's `package.json` and asserts no sibling engine, and R8
  still holds for `observability`'s own (unchanged) dependencies.
- **`@harness/embeddings` stayed at `[domain, db, event-bus]`** (R10): the re-embed
  listener and indexer live there; the cache and its invalidation live in
  `context-engine`, so no boundary was crossed by moving the cache into the engine
  that owns collection.

## Decisions / debts carried into Week 5

- **Do not switch the ranking.** Nothing this week justifies a live semantic
  switch; the whole point of the shadow is to gather the comparison first. Week 5
  opens on the object store + sandboxes, and the semantic switch decision stays
  parked until the Day-29 dry-run has a number.
- **The object store is the next seam.** Day 21 replaces the inline
  `artifact.created` `content` blob with a `ContentStore` (S3/MinIO) for large
  artifacts (Spec 5 §4.2). The cache deliberately does **not** hold large blob
  content — keep it that way; the two optimizations are orthogonal and the cache
  must remain a per-source, read-only, small-content leaf.

---

_Checkpoint rule applied: `pnpm lint`, `pnpm -r typecheck`, and `pnpm -r test`
are green (112 test files, 546 tests — including the 12 new Day-20 cache/listener
tests and the 6 semantic-shadow tests). `pnpm e2e` (migrate through 0026 + happy
path + 8 failure scenarios) is green. The served `rank_method` remains
`phase1-keyword-dependency`, `metadata.tokenizer` reports `tiktoken:cl100k_base`,
and R4/R8/R10 are asserted by `packages/di/src/__tests__/architecture.test.ts`._
