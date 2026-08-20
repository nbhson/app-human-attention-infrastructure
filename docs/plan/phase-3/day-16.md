# Day 16 — Hybrid Retriever as Default: BM25 Lexical + Embedding Semantic Fused

| | |
|---|---|
| **Week** | 4 — Hybrid context default |
| **Spec refs** | Spec 4 §5.1 (hybrid retrieval: lexical + semantic behind `Retriever`; RRF default fusion), §5 (ranking formula) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 15 (Week 3 checkpoint — targeted verify correct + faster) |

---

## 1. Objectives

By end of day you will have:

1. A **hybrid `Retriever` implementation** that runs, in parallel, a **BM25 lexical retriever** (Phase 2 `pg_trgm`/FTS) and a **semantic retriever** (Phase 2 `pgvector` + `Embedder`), and fuses the result sets.
2. The hybrid implementation **behind the existing `Retriever` interface** (Spec 4 §5.1 — "Phase 3 adds the hybrid implementation behind the same interface").
3. A fusion stage (RRF default, Spec 4 §5.1) that needs no score normalization.
4. Wiring so the hybrid retriever is *selected* as default — but the `rank_method` cutover (A/B proof) is deferred to Day 19.

This is the first half of the "hybrid default" week; Day 17 adds the re-rank stage, Day 19 performs the measured cutover.

---

## 2. Design Decisions

### 2.1 Two retrievers, one interface (no new seam)

```typescript
// packages/context-engine/src/retrieval/retriever.ts
export interface Retriever {  // ALREADY EXISTS from Phase 1/2
  retrieve(query: string, opts?: RetrieveOptions): Promise<RetrievedDoc[]>;
}

export interface RetrievedDoc {
  sourceId: string;         // ContextSource.sourceId
  score: number;            // normalized relevance in [0,1] (final fused/reranked)
  rank: number;             // position in the final list
  matchedBy: 'lexical' | 'semantic' | 'both';
  content: string;
  metadata: Record<string, unknown>;
}
```

`LexicalRetriever` (BM25 over code+doc index via `pg_trgm`/FTS) and `SemanticRetriever` (cosine over `pgvector` embeddings via `Embedder`) both implement `Retriever`. `HybridRetriever` composes both and exposes the fused result.

### 2.2 Hybrid composition + fusion

```typescript
// packages/context-engine/src/retrieval/hybrid-retriever.ts
export class HybridRetriever implements Retriever {
  constructor(
    private readonly lexical: Retriever,
    private readonly semantic: Retriever,
    private readonly fusion: Fusion,       // RRF (Day 17 re-rank slots in after this)
  ) {}

  async retrieve(query: string, opts?: RetrieveOptions): Promise<RetrievedDoc[]> {
    const [lex, sem] = await Promise.all([
      this.lexical.retrieve(query, opts),
      this.semantic.retrieve(query, opts),
    ]);
    return this.fusion.fuse(lex, sem);     // deterministic, no normalization needed
  }
}
```

**Parallel fetch** is the point: lexical catches exact-symbol/keyword matches semantic misses (and vice-versa), and running both concurrently keeps latency close to the slower single retriever.

### 2.3 RRF as the default fusion (Spec 4 §5.1, k=60)

```typescript
export function reciprocalRankFusion(rankings: RetrievedDoc[][], k = 60): RetrievedDoc[] {
  // score(d) = Σ 1/(k + rank_i(d)); rank starts at 1
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((doc, idx) => {
      const rrf = 1 / (k + (idx + 1));
      scores.set(doc.sourceId, (scores.get(doc.sourceId) ?? 0) + rrf);
    });
  }
  return sortByScoreDesc(scores);
}
```

- `k=60` (Spec 4 §5.1 "`k` ≈ 60"). `k` gates raw-score magnitude but RRF only uses *ranks*, so a single big `k` value across both retrievers works without per-retriever tuning.
- Ties at `k=60` (e.g. both retrievers return the same doc at rank 1) are fine — the dedup via `sourceId` and the `matchedBy` marker handles overlap.

### 2.4 Ranker vs Retriever split (do not collapse them)

The `Ranker` (Spec 4 §5: `relevance_score` weighting) still operates *after* the `Retriever` returns candidates. Keep the pipeline:

```text
retrieve (HybridRetriever → candidate set, rank fused)
   → re-rank (Day 17: dependency/recency/usage heuristics + optional cross-encoder)
   → budget trim (existing Context §6)
   → ContextSnapshot
```

Do not fold ranking heuristics into the retriever today — Day 17 owns the re-rank stage.

### 2.5 Default selection is *config, not code*

Register the hybrid as the default `Retriever` in DI but drive the switch via the existing `rank_method` column (Phase 2 kept `keyword` as default). The actual cutover happens on Day 19 after the A/B. Today: both implementations are live and *selectable*, default still `keyword` until Day 19 flips it.

---

## 3. Tasks

### 3.1 Verify/extend the Phase-2 lexical + semantic retrievers (90 min)

- [ ] Confirm `LexicalRetriever` (BM25/FTS) and `SemanticRetriever` (pgvector/Embedder) exist from Phase 2 and both implement `Retriever`. Fix/align signatures to `RetrievedDoc` (§2.1).

### 3.2 `HybridRetriever` + RRF (120 min)

- [ ] `packages/context-engine/src/retrieval/hybrid-retriever.ts` (§2.2) with parallel fetch.
- [ ] `packages/context-engine/src/retrieval/rrf.ts` — `reciprocalRankFusion` (§2.3, k=60).
- [ ] Unit tests: RRF rank math; dedup via `sourceId`; `matchedBy` set correctly for overlap.

### 3.3 Reference the hybrid in the resolution pipeline (90 min)

- [ ] Swap the resolution pipeline's hard-coded single retriever call to go through the registered `Retriever` (which is now `HybridRetriever`).
- [ ] Ensure `context_snapshots.rank_method` records `hybrid` when hybrid is selected (column value, no schema change).

### 3.4 Config seam for `rank_method` (60 min)

- [ ] Add a `rank_method` resolver (`keyword` | `hybrid` | `rag_fusion` later) that picks the retriever without callers changing.
- [ ] Default remains `keyword` today (Day 19 flips to `hybrid` post-A/B).

### 3.5 Tests (120 min)

- [ ] A query with an exact symbol match ranks lexically; a paraphrase query ranks semantically; `HybridRetriever` returns both.
- [ ] RRF fusion produces a deterministic ordering on a known double-ranking fixture.
- [ ] `rank_method=keyword` uses the old ranker; `hybrid` uses the new one (config switch proven).
- [ ] Boundary test: hybrid code lives in `context-engine`, no new package, no cross-engine import.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/retrieval/retriever.ts` | `Retriever`, `RetrievedDoc` contracts |
| `packages/context-engine/src/retrieval/hybrid-retriever.ts` | `HybridRetriever` (parallel + compose) |
| `packages/context-engine/src/retrieval/rrf.ts` | `reciprocalRankFusion` (k=60) |
| `packages/context-engine/src/retrieval/retriever-factory.ts` | `rank_method` → retriever resolver |
| `packages/context-engine/src/__tests__/hybrid.test.ts` | Hybrid + RRF tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/context-engine test` — all tests pass.
- [ ] `HybridRetriever` composes lexical + semantic behind the **existing** `Retriever` interface (no new seam).
- [ ] RRF (`k=60`) fuses two rankings deterministically with rank-based score `1/(60+rank)`.
- [ ] Parallel fetch: lexical and semantic executed concurrently (test with latency spy or ordering).
- [ ] `RetrievedDoc.matchedBy` correctly reports `lexical` / `semantic` / `both`.
- [ ] `rank_method` value recorded on the snapshot is `keyword` by default today (hybrid selectable, not yet default).
- [ ] `pnpm lint` clean; no cross-engine import introduced.

---

## 6. Notes & Pitfalls

- **Do not make hybrid default yet.** The README invariant is warp-and-weft here: *hybrid earns default status by winning the A/B, not by being newer.* Today builds; Day 19 measures; Day 20 confirms the clean cutover. Flipping now is the exact discipline failure this phase guards against.
- **RRF uses ranks, not raw scores.** `k=60` exists *because* raw BM25 and cosine aren't comparable. If you "improve" RRF by multiplying ranks by raw scores, you've reintroduced the normalization problem it exists to solve.
- **Ties at k=60 are expected, not a bug.** Both retrievers top-1 the same doc? `score = 2/(60+1)`, `matchedBy='both'`. Resolve list order deterministically (e.g. lexical-first or `sourceId` tie-break) and document it.
- **Overlap isn't double-counted.** Fuse on `sourceId`, not on doc object identity — the same file returned by both is one candidate, stronger by virtue of two rankings agreeing.
- **Embeddings are still shadow elsewhere.** The semantic retriever is only "real" here because Phase 2 populated `pgvector`; ensure the `Embedder` call has a fallback (lexical-only) if the embedding index is cold for a source — a missing embedding must not silently zero out a candidate.
- **Tomorrow (Day 17):** RRF re-rank — dependency/recency/usage heuristics (Spec 4 §5.1).

---

*Prev: [Day 15 — Week 3 Checkpoint: Targeted Verification Faster + Still Correct](day-15.md) | Next: [Day 17 — Re-rank: Dependency/Recency/Usage Heuristics over Fused Top-N](day-17.md)*
