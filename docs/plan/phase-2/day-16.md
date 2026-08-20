# Day 16 — pgvector Migration, `Embedder` Interface & Provider Adapter

| | |
|---|---|
| **Week** | 4 — Semantic infra (shadow) |
| **Spec refs** | Spec 4 §5.1 (embedding index is separate replaceable infra; `Embedder` as shadow), §2.2 (ContextSource), Phase-2 README §3 (pgvector) |
| **Estimated effort** | 7 hours |
| **Prerequisites** | Day 15 (calibration locked); PostgreSQL 16 running; Phase-1 `context_sources`/`context_snapshots` |

---

## 1. Objectives

By end of day you will have:

1. A **pgvector-enabled database** — `CREATE EXTENSION vector` and a vector column on the context source shard table, with an HNSW index.
2. A new **`packages/embeddings`** holding the `Embedder` interface and a provider adapter (e.g. an OpenAI-compatible embeddings endpoint), with a deterministic stub for tests.
3. A **shadow-only guarantee**: the vector column and `Embedder` are installed and usable by tests/tools, but **nothing on the live `rank_method` path touches them** — the default ranker is `keyword` and remains so.
4. The **boundary rule** that lets the context engine consume `@harness/embeddings` as infra (not another engine).

This is the start of the biggest "widening, not changing" moment of Phase 2: the semantic index is installed *behind* the `Retriever`/`Ranker` seam and measured by the A/B harness, while the production pipeline keeps its keyword default — the standing shadow-then-default rule.

---

## 2. Design Decisions

### 2.1 Vector column lives on the source shard, keyed by existing `ContextSource.type`

Spec 4 §5.1 already distinguishes `FILE | SYMBOL | ARCHITECTURE | DOCUMENTATION` as stable shard keys. The embedding column attaches to the context source row (not to raw artifact blobs), so one physical index serves both retrieval and the shadow metrics:

```sql
-- packages/db/migrations/0110_pgvector.sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE context_sources
  ADD COLUMN embedding vector(1536);           -- dimension = provider default; adjustable

CREATE INDEX context_sources_embedding_idx
  ON context_sources USING hnsw (embedding vector_cosine_ops);
```

Dimension is a constant set by the adapter (1536 for OpenAI-style `text-embedding-3-small`); the `Embedder` interface carries it so nothing hard-codes 1536.

### 2.2 `Embedder` interface — provider adapter, test stub

```typescript
// packages/embeddings/src/embedder.ts
export interface Embedder {
  readonly dimensions: number;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;         // one vector per input, same order
  embedQuery(text: string): Promise<number[]>;          // query may use a different instruction
}

// packages/embeddings/src/providers/openai-compatible.ts
export class OpenAICompatibleEmbedder implements Embedder {
  constructor(private cfg: { baseUrl: string; apiKey: string; model: string }) {}
  /* POST {baseUrl}/embeddings, map response → n × dims */
}

// packages/embeddings/src/providers/stub.ts
export class StubEmbedder implements Embedder {         // deterministic, for tests
  embed(texts) { /* hash-based deterministic unit vectors */ }
}
```

**Rules:** (1) `embed` is batched and order-preserving — callers rely on index alignment; (2) the adapter retries transient network errors with backoff and **never throws into the ranker** (returns a typed error the caller logs); (3) the stub is deterministic byte-for-byte so tests don't call a live provider.

### 2.3 Shadow-then-default, made mechanical

The live `resolveContext` path calls the **existing** keyword ranker. The only things that touch `context_sources.embedding` today are:

- the index-population job (Day 17),
- the semantic retriever behind the seam, disabled by default (Day 18),
- the A/B harness variant `semantic-shadow` (already declared Day 09).

Concretely: no `embeddings` import exists in the context engine's *default* path. Test the negative — `resolveContext` with a keyword task performs zero `Embedder.embed` calls.

### 2.4 Boundary rule R10

`packages/embeddings` imports `@harness/domain` only (and optional provider deps). `context-engine` is extended to import `@harness/embeddings` as **infra** (tier with `db`/`di`/`observability`), still never another engine. Add to ESLint + architecture test.

---

## 3. Tasks

### 3.1 pgvector migration (45 min)

- [ ] Migration `0110_pgvector.sql` (§2.1); verify `SELECT extname FROM pg_extension WHERE extname='vector'`.
- [ ] Ensure `docker-compose.yml` uses `pgvector/pgvector:pg16` (or installs the extension) — note the image change.

### 3.2 Scaffold `packages/embeddings` + interface (60 min)

- [ ] `package.json` (`@harness/embeddings`), `src/embedder.ts` (§2.2).
- [ ] `src/providers/stub.ts` — deterministic stub.

### 3.3 Provider adapter (75 min)

- [ ] `src/providers/openai-compatible.ts` — batched, order-preserving, retry-with-backoff, non-throwing errors.
- [ ] `.env.example` — `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL`.

### 3.4 DI wiring (45 min)

- [ ] Register `TOKENS.Embedder` (stub by default); wire into `bootstrap.ts`; `docs/architecture/wiring-map.md`.

### 3.5 Tests (105 min)

- [ ] `StubEmbedder` is deterministic: `embed(["a","b"])` twice → identical vectors; order preserved.
- [ ] Adapter maps a canned HTTP response to `n × dims` correctly (mock fetch).
- [ ] Adapter returns a typed error (not a throw) on a 429/network failure.
- [ ] **Shadow negative test**: `resolveContext` with a keyword task performs zero `embed` calls (counting proxy on the injected `Embedder`).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0110_pgvector.sql` | `vector` extension + column + HNSW index |
| `docker-compose.yml` (updated) | `pgvector/pgvector:pg16` |
| `packages/embeddings/src/embedder.ts` | `Embedder` interface |
| `packages/embeddings/src/providers/{openai-compatible,stub}.ts` | Adapter + stub |
| `packages/embeddings/src/__tests__/embedder.test.ts` | §3.5 matrix |

---

## 5. Acceptance Criteria

- [ ] `SELECT 1` against `pgvector/pgvector` succeeds; `\dx` lists `vector`; `\d context_sources` shows the `embedding vector(1536)` column.
- [ ] `StubEmbedder.embed` is order-preserving and deterministic (two runs byte-identical).
- [ ] `OpenAICompatibleEmbedder` returns `n × dims` for `n` inputs, with order preserved (mock HTTP test).
- [ ] Adapter's 429/network path returns a typed error and does **not** throw into the caller.
- [ ] The **shadow negative**: `resolveContext` on a keyword task makes zero `embed` calls.
- [ ] `TOKENS.Embedder` registered and resolvable, defaulting to the stub.
- [ ] `grep -r "from '@harness" packages/embeddings/src` shows only `@harness/domain`.
- [ ] `pnpm --filter @harness/embeddings test` green; `pnpm lint` green (R10 enforced).

---

## 6. Notes & Pitfalls

- **`pgvector` ≠ `pg_trgm`.** They solve different problems and you'll need both (trigram for lexical/FTS, vector for semantic). Do not confuse the operators (`<->` cosine vs `%` similarity) — this confusion is the most common Phase-2 bug, and it silently produces *wrong-but-plausible* rankings.
- **The image matters.** Stock `postgres:16-alpine` (Phase 1) has no `vector` extension. The switch to `pgvector/pgvector:pg16` must happen *and* be reflected in CI's service container, or the migration fails in one spot but not the other.
- **Dimension drift is a real failure mode.** If you re-point the adapter at a model with a different dimension while old vectors remain, `vector_cosine_ops` errors on mixed dims. Re-embedding (Day 17) is the fix; today just keep `dimensions` a property of the adapter, never a hand-typed literal in the index.
- **The shadow guarantee is a *negative* test, not a comment.** The "zero embed calls on the default path" test is the thing that keeps Week 4 honest. Without it, a semantic call sneaks in and the "default" ranker changes without anyone noticing.
- **Never throw from an embedder into the ranker.** A flaky provider must degrade to a logged no-op, not a failed `resolveContext`. Ranking is a best-effort path; the pipeline must keep running with keyword-only if embeddings are down.
- **Next (Day 17):** populate the index — embed existing sources/artifacts and re-embed on artifact change.

---

*Prev: [Day 15 — Week 3 Checkpoint: Calibration & Auto-Approve](day-15.md) | Next: [Day 17 — Index Population: Embed Sources/Artifacts, Re-embed on Change](day-17.md)*
