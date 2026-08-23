# Day 28 — RAG Fusion behind `Retriever`

| | |
|---|---|
| **Week** | 6 — Hybrid context default |
| **Spec refs** | Context §5.1–5.2 (optional RAG Fusion); Phase-3 README §3 (Retrieval anchor, "optional RAG Fusion") |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 26–27 (hybrid + RRF + re-rank) |

---

## 1. Objectives

By end of day you will have:

1. An **optional `RagFusionRetriever`** behind the same `Retriever` interface: generate K rewritten query variants (behind `LLMProvider`), retrieve per variant, fuse the union via RRF.
2. `rank_method` gains `rag_fusion` as an *opt-in* variant — never the default; the hybrid path remains the Day-29 candidate for default.
3. A `Retriever`-level abstraction proving RAG Fusion, hybrid, and keyword are swappable through one seam.
4. Guardrails: variant count + latency bounded; failure to generate variants degrades gracefully to the single-query hybrid.

This is the optional breadth item — built behind the seam, not promoted.

---

## 2. Design Decisions

### 2.1 RAG Fusion = query expansion, then RRF over the union

`rewriteQueries(query, k)` (LLM) → run `HybridRetriever` per variant → collect all candidate sets → `reciprocalRankFusion` over the union. Reuse Day 26's RRF unchanged — the multi-query union is the only new part.

### 2.2 Opt-in only

`RagFusionRetriever` registers as a selectable `rank_method = 'rag_fusion'`; nothing defaults to it. The Day 29 A/B is hybrid-vs-keyword; RAG Fusion is measured separately (if at all) and can only become a default through its own A/B.

### 2.3 Degrade gracefully

If `LLMProvider` rewrites fail or timeout, fall back to a single-query hybrid result — a variant-generation failure must not degrade *correctness* to an empty context.

### 2.4 Bounded cost

`k` capped (default 3) and a total latency budget; the extra LLM calls are the cost, and the cap makes it predictable.

---

## 3. Tasks

### 3.1 Variant generation (60 min)

- [ ] `rewriteQueries(query, k)` behind `LLMProvider` with cap + timeout.

### 3.2 `RagFusionRetriever` (90 min)

- [ ] Multi-variant retrieve → union → RRF; graceful fallback on generation failure.

### 3.3 Resolver + plumbing (45 min)

- [ ] `rank_method = 'rag_fusion'` resolves to the new retriever; snapshot records it.

### 3.4 Tests (75 min)

- [ ] Union + RRF over multiple variants; fallback on LLM failure; latency/count cap; retriever-swappable test across all three methods.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/retrieval/rag-fusion-retriever.ts` | Multi-query RAG Fusion |
| `packages/context-engine/src/retrieval/query-rewriter.ts` | Variant generation (LLM) |
| `packages/context-engine/src/retrieval/retriever-factory.ts` (updated) | `rag_fusion` resolver |
| `packages/context-engine/src/__tests__/rag-fusion.test.ts` | RAG Fusion tests |

---

## 5. Acceptance Criteria

- [ ] `RagFusionRetriever` retrieves per variant and fuses the union via RRF.
- [ ] `rank_method = 'rag_fusion'` selects it; default unchanged.
- [ ] Variant-generation failure falls back to single-query hybrid (non-empty).
- [ ] `k` + latency capped.
- [ ] All three methods (keyword/hybrid/rag_fusion) swappable through `Retriever`.

---

## 6. Notes & Pitfalls

- **Optional means optional.** RAG Fusion is breadth, not the default path; don't let it absorb the Day-29 cutover work.
- **Fallback preserves correctness.** A failed rewrite that returns an empty context is a regression, not a graceful degradation — test the non-empty fallback explicitly.
- **Cap the LLM spend.** Variant rewriting is the most expensive retrieval path; make cost predictable or it will never clear an A/B.
- **Day 29:** hybrid default cutover — A/B vs the phase-2 shadow baseline.

---

*Next: [Day 29 — Hybrid Default Cutover; A/B vs Shadow Baseline](day-29.md)*