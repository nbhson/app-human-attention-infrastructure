# @harness/embeddings — Text-Embedding Seam & Semantic Index

The embedding-provider seam and the populate/health pipeline behind semantic
retrieval. Installed in **shadow mode** by default — it indexes and scores
without becoming the context ranker.

**Status:** complete (as-built) ·
**Boundary rule:** shared package — imports only `@harness/domain`, `@harness/db`, `@harness/event-bus`, `@harness/di`.

---

## Purpose

1. **Define the `Embedder` seam** — a provider abstraction with a deterministic stub default.
2. **Index sources** — batch, resumable, idempotent embedding population.
3. **Keep the index fresh** — re-embed on `artifact.created` / `artifact.changed`.
4. **Report health** — whether the vector index is in sync with its sources.

---

## Pipeline

```text
            sources (backfill + artifact events)
                         │
                         ▼
        ┌────────────────────────────────┐
        │        EmbeddingIndexer         │  batch, resumable, idempotent
        │  (Embedder seam → vector rows)  │
        └───────────────┬────────────────┘
                        │
        ┌───────────────┴────────────────┐
        │      reembed-listener          │  re-embed on artifact.changed
        └───────────────┬────────────────┘
                        │
        ┌───────────────┴────────────────┐
        │         health.ts              │  isFreshVector / computeIndexHealth
        └────────────────────────────────┘
```

---

## The `Embedder` seam

| Provider | When |
| --- | --- |
| `StubEmbedder` (`providers/stub.ts`) | The DI default — deterministic, no live model. |
| `OpenAICompatibleEmbedder` (`providers/openai-compatible.ts`) | Real provider — retrying, non-throwing adapter. |

`EmbedError` + a result discriminator make provider failures a returned
error, not a thrown exception. `context-engine` consumes embeddings **through
the seam**, never this package's concrete classes.

---

## Health

`health.ts` answers the operating question "is the index in sync?" —
`isFreshVector` (per-vector freshness) and `computeIndexHealth` (aggregate
index/source freshness). The index is rebuilt or resumed without duplicating
rows, because indexing is idempotent.

---

## Modules

| Module | What it provides |
| --- | --- |
| `embedder.ts` | `Embedder` interface, `EmbedError`, result discriminator. |
| `providers/stub.ts` | `StubEmbedder` — deterministic default. |
| `providers/openai-compatible.ts` | `OpenAICompatibleEmbedder`. |
| `indexer.ts` | `EmbeddingIndexer` — batch, resumable, idempotent. |
| `sources.ts` | Backfill + event source gathering. |
| `reembed-listener.ts` | Re-embed a source on `artifact.created`/`changed`. |
| `health.ts` | `isFreshVector`, `computeIndexHealth`. |
| `logger.ts` | The structural `IndexLogger` seam. |
| `cli.ts` | Backfill CLI. |

---

## Interaction with other packages

```text
      agent-runtime/artifact-tracker ──(artifact.* events)──▶ embeddings (re-embed)
      embeddings ──(embedder seam)──────────────────────────▶ context-engine (semantic ranker)
```

No engine is imported here — `context-engine` is the only consumer, through the
seam.

---

## Key invariants

- **Shadow-then-default.** Embeddings are *produced* here; `rank_method` in
  `context-engine` stays `keyword` until a measured A/B win flips it.
- **Idempotent indexing.** Re-running the backfill does not duplicate rows.

---

## Directory structure

```
src/
├── index.ts
├── embedder.ts
├── indexer.ts
├── sources.ts
├── reembed-listener.ts
├── health.ts
├── logger.ts
├── cli.ts
└── providers/
    ├── stub.ts
    └── openai-compatible.ts
```

## Public API surface

```typescript
// Embedder, EmbedError, StubEmbedder, OpenAICompatibleEmbedder,
// EmbeddingIndexer, sources, reembed listener, isFreshVector/computeIndexHealth
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`; `TOKENS.Embedder` (stub by default)
and the re-embed listener are what other packages resolve.