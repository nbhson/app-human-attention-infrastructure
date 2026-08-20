# Day 03 — Memory Retrieval: Relevance Scoring Served to Context

| | |
|---|---|
| **Week** | 1 — Memory store & retrieve |
| **Spec refs** | Spec 9 §4.5 (relevance scoring, retrieval patterns), §4.3 (retrieval via Context ranking signal, not auto-injection) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 02 (distillation + versioned append-only writes, `MemoryIngestion`) |

---

## 1. Objectives

By end of day you will have:

1. A **relevance scorer** implementing Spec 9 §4.5 exactly: `score = 0.6·similarity + 0.2·recency + 0.2·access_frequency`.
2. A **retrieval API** (`MemoryStore.retrieve(query, kind?, limit)`) that ranks candidates by that score and increments retrieval counters.
3. A **Context-facing seam**: memory results surface as a ranking *signal* to the Context Engine (Spec 9 §4.3 — "retrieval via Context Engine ranking signal, not auto-injection"), behind a resolver registered in DI, not a direct import.
4. Retrieval counters (`retrievedCount`, `lastRetrievedAt`) updated transactionally on every serve, so Day 03's access signal feeds Day 04's write-back and Day 06's decay.

This is the "read" half of the Memory store, and the first point where Memory feeds another subsystem.

---

## 2. Design Decisions

### 2.1 The scoring function (Spec 9 §4.5, verbatim)

```
rank = 0.6 · similarity + 0.2 · recency + 0.2 · access_frequency
```

| Term | Definition | Source of truth |
|------|-----------|-----------------|
| `similarity` | cosine similarity between query embedding and entry `content` embedding (fallback: keyword/Jaccard overlap when no embedding yet) | `Embedder` (Phase 2) / `pgvector` |
| `recency` | normalized recency of `lastRetrievedAt` (or `createdAt` if never retrieved) | `memory_entries.last_retrieved_at` |
| `access_frequency` | normalized `retrievedCount` (log-scaled, capped) | `memory_entries.retrieved_count` |

Normalize each term to `[0,1]` before weighting. `recency = exp(-days_since_last_use / τ)` with `τ = 30` (decays to ~0.37 after a month) — or, if never used, `recency = exp(-days_since_created / τ)`.

### 2.2 Similarity has two stages (no embedding yet → not a blocker)

Phase 2 installed `pgvector` + `Embedder` in **shadow**. Memory must work before hybrid becomes default. So `similarity` degrades gracefully:

1. **If an embedding exists** for the entry `content` → cosine via `pgvector`.
2. **Otherwise** → lexical fallback: `Jaccard`/keyword overlap between the query tokens and the entry `content` (mirrors Phase 1's `keyword_overlap` term).

The `SimilarityProvider` interface hides both cases; Day 16's hybrid retriever reuses it.

```typescript
export interface SimilarityProvider {
  similarity(query: string, content: string): Promise<number>;  // [0,1]
}
```

### 2.3 Serve = rank + count (atomic)

`retrieve()` ranks, then increments `retrievedCount`/`lastRetrievedAt` for the *served* entries in the same transaction as the read. If the counter update is a separate step, a crash between "returned" and "counted" silently loses the access signal that Day 04/06 depend on.

```sql
-- after selecting the top-N rows:
UPDATE memory_entries
SET retrieved_count = retrieved_count + 1,
    last_retrieved_at = now()
WHERE id = ANY($served_ids)
RETURNING id;
```

### 2.4 Context seam (no engine→engine import)

Memory is consumed by the Context Engine as a *signal source*, not by calling into Memory. Two allowed channels:

1. **Resolver in DI:** `ContextEngine` receives a `DecisionCollector` / `MemorySignalSource` that the bootstrap wires to `MemoryStore.retrieve`. The Context Engine only sees the interface.
2. **Event/query:** contexts read memory when resolving a `ContextRequest` (Spec 4 §4.5 "Previous Decision Retriever").

```typescript
// packages/context-engine sees this interface (from @harness/domain or a shared contract)
export interface MemorySignalSource {
  retrieve(query: string, kind?: MemoryKind, limit?: number): Promise<MemoryEntry[]>;
}
```

`MemoryStore` *implements* `MemorySignalSource`; the wiring lives in `bootstrap.ts`. **Neither package imports the other.**

### 2.5 Retrieval patterns (Spec 9 §4.5) mapped to kinds

| Pattern | Kind | Injection policy |
|---------|------|------------------|
| Summary Memory | `PROJECT`, `ARCHITECTURE` | Global (Level 0/1 in Spec 4 §5.2.1) |
| Entity Memory | `TASK`, `SESSION` | Pulled when the entity enters context |
| Failure Memory | `FAILURE` | Pulled for risk scoring (Spec 6 / Attention) |

Memory retrieval is **targeted** — the *previously retrieved* counter matters because frequently retrieved entries must not be drowned by a pure similarity score (§4.5: "frequently-retrieved entries are not lost to a pure embedding score").

---

## 3. Tasks

### 3.1 `SimilarityProvider` (45 min)

- [ ] `packages/memory/src/similarity.ts` — interface + `EmbeddingSimilarityProvider` (pgvector cosine) + `LexicalSimilarityProvider` (Jaccard).
- [ ] Unit tests: identical strings → 1.0; unrelated strings → ~0; embedding mock returns deterministic values.

### 3.2 Scorer (60 min)

- [ ] `packages/memory/src/scorer.ts` — `scoreEntry(query, entry, similarityProvider)` returns `{ similarity, recency, access, rank }`.
- [ ] Tests: the weights sum to 1.0 and each term contributes its stated fraction (fix two terms, vary the third, assert the slope).

### 3.3 `MemoryStore.retrieve` (90 min)

- [ ] `retrieve(query, kind?, limit = 10)`:
  - Load candidates (optionally by `kind`), excluding superseded heads' predecessors (serve the *current* version, per §4.4 "retrieval always reads current pointer").
  - Score each candidate; sort desc; take `limit`.
  - Atomically bump `retrievedCount`/`lastRetrievedAt` for served entries.
  - Publish `memory.entries_retrieved { query, entryIds, kind }` at most once per call (a batch event, not per-entry).
- [ ] Tests: ordering by score; limit respected; counters bumped exactly once; predecessor versions excluded.

### 3.4 Context seam + DI (60 min)

- [ ] Define `MemorySignalSource` in `@harness/domain` (shared contract).
- [ ] `MemoryStore` implements it; register `MemorySignalSource → MemoryStore` in DI (interface token, never the class).
- [ ] In `context-engine`, add a `DecisionCollector` that calls the injected `MemorySignalSource` and folds results into the `DECISION`/`EVIDENCE` context sources (Spec 4 §4.5). Gate it behind the existing `ContextPolicy.include_previous_decisions`.
- [ ] Update `docs/architecture/wiring-map.md`.

### 3.5 Integration test (90 min)

- [ ] Seed 2 `DECISION` entries (one recent, one old, similar content); assert `retrieve('approve payment refactor', 'DECISION')` ranks the recent one higher when similarity is equal.
- [ ] Assert retrieval bumps `retrievedCount` and the second call returns a higher `access_frequency` contribution for the served entry.
- [ ] Assert the Context Engine's decision collector includes a memory `DECISION` source in the snapshot when `include_previous_decisions` is true.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/memory/src/similarity.ts` | `SimilarityProvider` + embedding/lexical impls |
| `packages/memory/src/scorer.ts` | `scoreEntry` (0.6/0.2/0.2) |
| `packages/memory/src/memory-store.ts` (updated) | `retrieve()` + atomic counter bump |
| `packages/domain/src/memory.ts` (updated) | `MemorySignalSource` contract |
| `packages/context-engine/src/collectors/decision-collector.ts` | Memory-as-signal integration |
| `apps/api/src/bootstrap.ts` (updated) | `MemorySignalSource` wiring |
| `packages/memory/src/__tests__/*.test.ts` | Similarity, scorer, retrieval tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/memory test` — all tests pass.
- [ ] `score = 0.6·sim + 0.2·recency + 0.2·access` — weights proven by test, sum = 1.0.
- [ ] `retrieve()` returns only **current** versions (superseded predecessors excluded).
- [ ] `retrieve()` bumps `retrievedCount`/`lastRetrievedAt` exactly once per serve (idempotent under a retry of the *read*).
- [ ] Memory results reach the Context Engine **only** via `MemorySignalSource` (grep proves no `@harness/memory` import in `context-engine/src`).
- [ ] `ContextPolicy.include_previous_decisions = false` disables memory injection.
- [ ] `memory.entries_retrieved` event is published as a single batch event per `retrieve()` call.
- [ ] `pnpm -r build` green (new cross-package contract compiles in both packages).

---

## 6. Notes & Pitfalls

- **Do not auto-inject memory into context.** Spec 9 §4.3 is explicit: retrieval is a *ranking signal*, not automatic inclusion. The `MemorySignalSource` seam exists so the Context Engine *asks*; it never receives memory unprompted.
- **Serve current, audit all.** Retrieval returns only the head version, but the superseded chain stays queryable for audit. Do not hide history from the audit query, only from ranking.
- **Counter bump atomicity matters more than it looks.** If `retrievedCount` drifts, the `access_frequency` term drifts, which quietly re-ranks memory into the "frequently retrieved" bias. The bump must be in the same transaction as the serve.
- **Log-scaling the access term.** Raw counts are heavy-tailed; a `log1p(retrievedCount)` normalization (capped at 1.0) prevents one hot entry from dominating forever. Decide the exact cap and write it down.
- **Embedding vs lexical fallback is a real seam.** Until Day 16–19 flips hybrid to default, most memory still scores lexically. Keep the fallback honest (a Jaccard score, not a guessed 0.5) so later A/B comparisons aren't poisoned.
- **Batch the retrieval event.** One `memory.entries_retrieved` per call, not one per entry — otherwise a 10-entry serve floods the event log.
- **Tomorrow (Day 04):** versioned write-back with `supersedes` chains, rollback/forget, and the update cross-check.

---

*Prev: [Day 2 — Memory Ingestion: Evidence → Distillation → Versioned Writes](day-02.md) | Next: [Day 4 — Versioned Write-back: supersedes, Rollback, Forget/Update Cross-check](day-04.md)*
