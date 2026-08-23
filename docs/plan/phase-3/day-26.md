# Day 26 — Hybrid Retriever Default: BM25 + Embeddings Fused

| | |
|---|---|
| **Week** | 6 — Hybrid context default |
| **Spec refs** | Context §5.1–5.2 (hybrid retrieval behind `Retriever`); Phase-3 README §3 (Retrieval anchor) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 25 (W5 checkpoint); Phase-2 lexical (FTS/BM25) + semantic (pgvector/Embedder) retrievers live |

---

## 1. Objectives

By end of day you will have:

1. A `HybridRetriever` running **BM25 lexical + embedding semantic** retrieval in parallel, fusing results — behind the existing `Retriever` interface.
2. RRF (reciprocal rank fusion) as the deterministic, normalization-free fusion default.
3. A `rank_method` resolver (`keyword` | `hybrid` | `rag_fusion` later) selecting the retriever without callers changing.
4. Hybrid **selectable but not yet default** — `rank_method` stays `keyword` until Day 29's measured cutover.

This is the build half of the hybrid-default week; the cutover is won on Day 29, never inherited here.

---

## 2. Design Decisions

### 2.1 One interface, two retrievers, one composer

Phase 2's lexical and semantic retrievers both implement `Retriever`; `HybridRetriever` composes them and runs them **concurrently** (parallel `Promise.all`), so latency ≈ the slower single retriever, not the sum.

### 2.2 RRF as default fusion

`score(d) = Σ 1/(k + rank_i(d))`, `k=60` — ranks only, so BM25 and cosine scores (incomparable scales) blend without normalization. Dedup by `sourceId`; mark overlap as `matchedBy: 'both'`.

### 2.3 Selection is config, not code

Register `HybridRetriever` in DI; drive selection via the existing `rank_method` column. Today the default stays `keyword`; the resolver just makes `hybrid` *reachable*.

### 2.4 Fail-safe on cold embeddings

If a source's embedding index is cold/absent, the hybrid falls back to lexical-only for that source rather than dropping the candidate — a missing embedding must not zero out a real match.

---

## 3. Tasks

### 3.1 Verify Phase-2 retrievers (60 min)

- [ ] Confirm lexical + semantic retrievers implement `Retriever`; align to `RetrievedDoc`.

### 3.2 `HybridRetriever` + RRF (120 min)

- [ ] `hybrid-retriever.ts` (parallel compose) + `rrf.ts` (`reciprocalRankFusion`, k=60).

### 3.3 `rank_method` resolver (60 min)

- [ ] Resolver mapping `keyword`/`hybrid`; snapshot records the method; default `keyword`.

### 3.4 Fail-safe cold embeddings (30 min)

- [ ] Lexical-only fallback when a source has no embedding.

### 3.5 Tests (90 min)

- [ ] RRF rank math; dedup + `matchedBy`; parallel fetch; `rank_method` selection; cold-embedding fallback.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/retrieval/hybrid-retriever.ts` | `HybridRetriever` |
| `packages/context-engine/src/retrieval/rrf.ts` | `reciprocalRankFusion` (k=60) |
| `packages/context-engine/src/retrieval/retriever-factory.ts` | `rank_method` → retriever resolver |
| `packages/context-engine/src/__tests__/hybrid.test.ts` | Hybrid + RRF tests |

---

## 5. Acceptance Criteria

- [ ] `HybridRetriever` composes lexical + semantic behind the existing `Retriever` interface.
- [ ] RRF (`k=60`) fuses two rankings deterministically — rank-based `1/(60+rank)`.
- [ ] Parallel fetch (lexical + semantic concurrent).
- [ ] `RetrievedDoc.matchedBy` reports `lexical`/`semantic`/`both`.
- [ ] `rank_method` records `keyword` by default today (hybrid selectable, not default).
- [ ] Cold-embedding source falls back to lexical-only, not dropped.

---

## 6. Notes & Pitfalls

- **Do not make hybrid default today.** The README invariant is explicit: *hybrid earns default by winning the A/B, not by being newer.* Build now, measure Day 28/29, cutover Day 29.
- **RRF uses ranks, not raw scores.** Multiplying ranks by raw scores reintroduces the normalization problem RRF exists to solve.
- **Overlap is one stronger candidate, not two.** Fuse on `sourceId`.
- **Day 27** adds the re-rank stage (dependency/recency/usage) over the fused top-N.

---

*Next: [Day 27 — RRF Fusion + Re-rank (Dependency/Recency/Usage)](day-27.md)*