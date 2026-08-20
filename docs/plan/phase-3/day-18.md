# Day 18 — RAG Fusion: Multi-query + Reciprocal Ranking behind Retriever

| | |
|---|---|
| **Week** | 4 — Hybrid context default |
| **Spec refs** | Spec 4 §5.2.5 (RAG Fusion: multi-query + RRF; optional, behind the seam) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 17 (re-rank over fused top-N) |

---

## 1. Objectives

By end of day you will have:

1. **RAG Fusion** implemented: expand the task into *k* query variants (paraphrase / symbol-focussed / history-focussed), run each against the index, fuse with RRF (Spec 4 §5.2.5).
2. The multi-query expansion **behind the `Retriever` seam** — an optional upgrade to the semantic retriever, **not** a new caller-facing interface and **not** the default.
3. A **query cost guard** so multi-query expansion cannot silently multiply embedding calls unboundedly.
4. A comparison note proving RAG Fusion raises recall for indirectly-related files (the reason Spec 4 calls it out).

This is the *optional* recall-enhancing branch of the retrieval path — the last of the three W4 retrieval capabilities.

---

## 2. Design Decisions

### 2.1 RAG Fusion retriever wraps the semantic retriever

```typescript
// packages/context-engine/src/retrieval/rag-fusion-retriever.ts
export class RagFusionRetriever implements Retriever {
  constructor(
    private readonly queryExpander: QueryExpander,
    private readonly semantic: Retriever,        // single-query semantic retriever (Day 16)
    private readonly fusion: Fusion,             // same RRF as Day 16 (k=60)
  ) {}

  async retrieve(query: string, opts?: RetrieveOptions): Promise<RetrievedDoc[]> {
    const variants = await this.queryExpander.expand(query, opts?.maxQueries ?? 3);
    const rankings = await Promise.all(variants.map(v => this.semantic.retrieve(v, opts)));
    return this.fusion.fuse(rankings);           // reciprocal rank over variant result sets
  }
}
```

It composes the *semantic* retriever (per Spec 4 §5.2.5: "upgrade the semantic retriever"), then fuses the variant results with the same RRF from §5.1. No new fusion algorithm.

### 2.2 Query expansion (k=3, bounded)

```typescript
export interface QueryExpander {
  expand(query: string, variants: number): Promise<string[]>;
}

export class RuleQueryExpander implements QueryExpander {
  // 1. paraphrase variant   — LLM paraphrase (cached, prompt-hashed) or lexical synonym swap
  // 2. symbol variant       — extract symbols/identifiers from the query, focus on them
  // 3. history variant      — "past decisions / prior context referencing <query>"
}
```

- Default `k=3`. `maxQueries` is configurable; the cost guard (§2.3) caps it.
- The paraphrase variant may use `LLMProvider` (MockLLM in tests) — **cached + `prompt_hash` recorded**, same discipline as Day 02 distillation.
- The symbol and history variants are rule-based (no LLM) — cheap, deterministic.

### 2.3 Query-diversity cost guard (the trap)

Each variant is an extra embedding + index scan. RAG Fusion's risk is cost, not correctness. Enforce:

```typescript
const MAX_RAG_FUSION_QUERIES = 3;      // hard cap
const RAG_FUSION_BUDGET_RATIO = 0.25;  // variants ≤ 25% of the max_tokens budget worth of retrieval
```

- `maxQueries` can never exceed `MAX_RAG_FUSION_QUERIES`.
- If the query is already long/expensive (token-estimated), reduce or skip expansion (fall back to single-query hybrid). Log `rag_fusion.degraded` when this happens.

### 2.4 Optionality + selection

- `rank_method` gains a value `rag_fusion` in the resolver (Day 16's factory): `keyword` (default) → `hybrid` → `rag_fusion`.
- RAG Fusion is **opt-in per project/policy** (`ContextPolicy.retrieval_variant: 'hybrid' | 'rag_fusion'`), never forced.
- The invariant holds: hybrid is the default; RAG Fusion is a *stronger recall* option behind the seam.

### 2.5 Recall evidence

Because RAG Fusion's value is recall, record `expandedQueryVariants` and `sourcesUniqueAfterFusion vs singleQuery` counts in snapshot metadata so Week 6/39 can measure whether it actually surfaces indirectly-related files.

---

## 3. Tasks

### 3.1 `QueryExpander` (90 min)

- [ ] `RuleQueryExpander` (§2.2) with paraphrase (LLM, cached)/symbol (rule)/history (rule) variants.
- [ ] `maxQueries` + dedup of near-identical variants.

### 3.2 `RagFusionRetriever` (120 min)

- [ ] Compose semantic + expander + RRF (§2.1); parallel retrieval over variants.
- [ ] Wire `rank_method='rag_fusion'` in the resolver factory.

### 3.3 Cost guard (60 min)

- [ ] Enforce `MAX_RAG_FUSION_QUERIES` + budget ratio (§2.3); emit `rag_fusion.degraded` on reduction/skip.
- [ ] Test: a 4-variant request is clamped to 3; an over-budget query falls back to single-query hybrid.

### 3.4 Recall metadata (45 min)

- [ ] Record `expandedQueryVariants` + source-count deltas in snapshot metadata.

### 3.5 Tests (150 min)

- [ ] A query with an indirect synonym surfaces a file the single semantic query missed (recall demo).
- [ ] Variant results fuse via RRF (deterministic order).
- [ ] `rank_method='rag_fusion'` opt-in selects RAG Fusion; default remains `hybrid` (after Day 19) / `keyword` (until then).
- [ ] Cost guard: clamp + degraded fallback.
- [ ] Query-variant cache reuse (`prompt_hash`) avoids duplicate LLM paraphrase calls.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/retrieval/rag-fusion-retriever.ts` | `RagFusionRetriever` |
| `packages/context-engine/src/retrieval/query-expander.ts` | `RuleQueryExpander` |
| `packages/context-engine/src/retrieval/cost-guard.ts` | Multi-query cost guard |
| `packages/context-engine/src/__tests__/rag-fusion.test.ts` | Recall + cost/pinning tests |
| `packages/context-engine/src/retrieval/retriever-factory.ts` (updated) | `rag_fusion` rank_method |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/context-engine test` — all tests pass.
- [ ] RAG Fusion expands to ≤ 3 queries, retrieves each, fuses via RRF (k=60).
- [ ] An indirectly-related file (synonym query) is recalled with RAG Fusion and missed by single-query (fixture-proven).
- [ ] `rank_method='rag_fusion'` is opt-in; default ranker unchanged.
- [ ] Query variant count is hard-capped at 3; over-budget requests degrade to single-query and emit `rag_fusion.degraded`.
- [ ] Paraphrase variants are cached by `prompt_hash` (no duplicate LLM calls).
- [ ] Expansion/variant metadata recorded for later recall evaluation.
- [ ] `pnpm lint` clean; still on the `Retriever` seam (no new interface leaked to callers).

---

## 6. Notes & Pitfalls

- **RAG Fusion is optional — keep it that way.** Spec 4 §5.2.5: "optional and behind the seam." Do not make it default, and do not let the resolver default to it for any project without an explicit policy flag.
- **The cost guard is the deliverable's spine.** k variants = k embedding calls + k scans. Without the cap + budget ratio, RAG Fusion makes context resolution 3× more expensive for a marginal recall gain — the opposite of the phase's latency goal.
- **Paraphrase determinism.** LLM paraphrase is stochastic; cache by `prompt_hash` + record the hash so a variant is reproducible (Day 28 judge audit + Day 39 regression rely on this).
- **Variant dedup.** Naive expansion can produce near-identical variants that waste budget and double-fuse the same docs. Dedup variants before retrieval.
- **Recall ≠ always better.** Higher recall also raises noise; the budget trim still runs after. Do not bypass compression because "RAG Fusion found it."
- **Tomorrow (Day 19):** integrate hybrid default — `rank_method` cutover + A/B vs the shadow baseline.

---

*Prev: [Day 17 — Re-rank: Dependency/Recency/Usage Heuristics over Fused Top-N](day-17.md) | Next: [Day 19 — Integrate Hybrid Default: rank_method Cutover + A/B vs Shadow Baseline](day-19.md)*
