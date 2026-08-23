# Day 18 — Memory Retrieval: Relevance Scoring, Served to Context

| | |
|---|---|
| **Week** | 4 — Review memory |
| **Spec refs** | Spec 9 §4.5 (retrieval relevance); Context §5.1–5.2 (served to Context); Phase-3 README §7 (relevance-scored retrieval) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 17 (ingestion + versioned entries live) |

---

## 1. Objectives

By end of day you will have:

1. `MemoryRetriever` scoring entries against a query/context — lexical + (shadow) semantic, plus kind/confidence weighting.
2. A **relevance score** per candidate, honed by `confidence`, recency, and retrieval history (`retrievedCount`/`lastRetrievedAt`).
3. Serving to Context: a DI-registered resolver/callback exposes "top-K memory" to context assembly for the *next* review — without `@harness/memory` importing `@harness/context-engine`.
4. Retrieval records access (`retrievedCount++`, `lastRetrievedAt`) and resolves the head of each `supersedes` chain.

This is the *read* half of review memory; the past informs the present review's attention/context.

---

## 2. Design Decisions

### 2.1 Retrieval = candidate recall + relevance rank

- Recall: lexical match (FTS/trigram) over `content` plus optional semantic match over embeddings (reuse Phase-2 `pgvector`/`Embedder`, shadow).
- Rank: `relevance = α·match + β·confidence + γ·recency`, with retrieval-history nudges so stale-but-popular vs fresh-but-cold entries rank sensibly.

### 2.2 Follow the version chain to the head

Retrieval returns the **head** entry of each `supersedes` chain (resolve the newest non-archived version); older versions stay queryable by id but don't surface as separate results.

### 2.3 Served via resolver, not import

`@harness/memory` exposes `MemoryProvider.retrieve(context)`; `context-engine` registers a resolver in DI that pulls top-K memory and injects it into the reviewer's context snapshot (a `memory` section). The dependency direction stays engine→seam, never memory→context.

### 2.4 Access counters update asynchronously

`retrievedCount++` runs after the result is served (fire-and-forget or outbox), so the hot retrieval path isn't blocked by a write.

---

## 3. Tasks

### 3.1 Scoring (90 min)

- [ ] `packages/memory/src/memory-retriever.ts` — candidate recall + `relevance` rank (lexical + confidence + recency).

### 3.2 Version-chain resolution (45 min)

- [ ] Resolve head-of-chain; suppress superseded versions from result sets.

### 3.3 Context resolver (60 min)

- [ ] DI resolver exposing top-K memory; context snapshot gains a `memory` section in `context-engine`.

### 3.4 Access tracking (30 min)

- [ ] Async `retrievedCount`/`lastRetrievedAt` update on serve.

### 3.5 Tests (75 min)

- [ ] Relevance ordering (popular + fresh outranks cold); head-of-chain only; access counters bump; context snapshot includes memory without engine import.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/memory/src/memory-retriever.ts` | Recall + relevance scoring |
| `packages/memory/src/chain-resolve.ts` | Head-of-chain resolution |
| `packages/context-engine/src/memory-resolver.ts` | Top-K memory → context snapshot |
| `packages/memory/src/__tests__/retrieval.test.ts` | Retrieval tests |

---

## 5. Acceptance Criteria

- [ ] `MemoryRetriever` returns relevance-ordered head-of-chain entries.
- [ ] Confidence + recency demonstrably affect ranking.
- [ ] Context snapshot for a review includes a `memory` section (top-K).
- [ ] `retrievedCount`/`lastRetrievedAt` updated after serve (async, no hot-path block).
- [ ] No `@harness/context-engine` import in `@harness/memory` (boundary intact).

---

## 6. Notes & Pitfalls

- **Serve, then count.** Updating `retrievedCount` on the hot path adds a write per read; do it async so retrieval latency stays flat.
- **Head-of-chain, not all-of-chain.** Surfacing four versions of one idea is noise; the head is the memory, history is the audit.
- **Shadow, not default.** If semantic match is used, keep it shadow first — retrieval relevance must be *measured* (it feeds attention weights later), not assumed.
- **Day 19:** lifecycle — consolidation/decay/archive.

---

*Next: [Day 19 — Memory Lifecycle: Consolidation/Decay/Archive](day-19.md)*