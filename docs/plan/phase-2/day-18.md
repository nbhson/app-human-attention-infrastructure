# Day 18 — Semantic Retriever in Shadow, Behind the `Retriever`/`Ranker` Seam

| | |
|---|---|
| **Week** | 4 — Semantic infra (shadow) |
| **Spec refs** | Spec 4 §5.1 (single `Retriever` interface; `Ranker` seam; shadow rule), §5.2.2 (lost-in-the-middle), Spec 11 §5 (A/B) |
| **Estimated effort** | 7 hours |
| **Prerequisites** | Day 17 (populated index + freshness guard); Day 16 (`Embedder`); Phase-1 `Ranker` returning `rank_method = 'keyword'` |

---

## 1. Objectives

By end of day you will have:

1. A **semantic retriever** — cosine similarity over the populated index — implemented **behind** the Phase-1 `Retriever`/`Ranker` seam, not as a new default.
2. A **shadow comparison path** that, for selected tasks (or all, behind a flag), computes the semantic ranking *alongside* the keyword ranking, logs both with their `rank_method`, and keeps the keyword result on the live path.
3. A hard guarantee that **`rank_method` default stays `keyword`** — no semantic result is ever written as the served `ContextSnapshot`'s `rank_method` in this phase.
4. The **measure** to make shadow meaningful — the same task resolved both ways, with the ordering difference captured for the A/B harness (Day 29).

This is the single most important day in Week 4. The shadow-then-default rule from the README, Spec 4 §5.1, and Architecture §24.2 all converge here: semantic ranking exists, is measured, and *does not* change what the agent receives.

---

## 2. Design Decisions

### 2.1 Insert at the seam, not around it

The Phase-1 context engine exposes the ranking seam as a `Ranker` (produces `rank_method + relevance_score`) and a `Retriever` (produces candidate sources). Today adds a **third implementation** behind those interfaces:

```typescript
// packages/context-engine/src/retrieval/semantic-retriever.ts
export class SemanticRetriever implements Retriever {
  constructor(private embedder: Embedder, private db: DrizzleDB) {}
  async retrieve(query: string, k: number): Promise<Candidate[]> {
    const q = await this.embedder.embedQuery(query);     // query vector
    return this.db.select()                               // HNSW cosine
      .from(contextSources)
      .where(sql`embedding_hash = content_hash`)         // freshness guard (Day 17)
      .orderBy(sql`embedding <-> ${pgvector(q)}::vector`)
      .limit(k);
  }
}
```

No change to the live `resolveContext` entry point. The keyword ranker is still the object `resolveContext` calls. The semantic retriever is *only* referenced by the shadow path (§2.2) and the A/B variant.

### 2.2 The shadow path — compute both, serve one, log both

```typescript
// packages/context-engine/src/retrieval/shadow.ts
export async function resolveWithShadow(request: ContextRequest): Promise<ContextSnapshot> {
  const keyword = await keywordRanker.rank(request);            // live (served)
  if (semanticShadowEnabled(request.projectId)) {               // flag, default OFF
    const semantic = await semanticRanker.rank(request);        // shadow (logged only)
    await recordShadowComparison({ request, keyword, semantic });// → shadow_rank_comparisons
  }
  return keyword;                                               // keyword ALWAYS served
}
```

The `semantic` ranking is written to a comparison record (`shadow_rank_comparisons`) with both ranked orderings and their `rank_method`s. It is **never** assigned to the returned snapshot's `rank_method`.

### 2.3 `rank_method` discipline — the invariant column

Spec 4 §2.2 already has `rank_method` in `ContextSnapshot`. In this phase its legal values are `keyword` (default) and, in a shadow record only, `semantic`. The served snapshot's `rank_method` is **always** `keyword`. Add a CHECK or a code-path assertion:

```ts
assert(snapshot.rank_method === 'keyword', 'Phase 2 invariant: default ranker is keyword');
```

### 2.4 Shadow comparison record — the A/B harness's raw material

```sql
-- packages/db/migrations/0112_shadow_rank.sql
CREATE TABLE shadow_rank_comparisons (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  context_id   text NOT NULL,
  keyword_order  jsonb NOT NULL,      -- [sourceId...] in keyword rank order
  semantic_order jsonb NOT NULL,      -- [sourceId...] in semantic order
  rank_correlation numeric,           -- a cheap agreement metric (e.g. Kendall tau on top-k)
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

The `rank_correlation` (agreement between the two orderings) is computed at write time so Day 29's head-to-head has a pre-aggregated signal, and so a "semantic barely differs from keyword" result is obvious before any A/B is run.

---

## 3. Tasks

### 3.1 Semantic `Retriever` + `Ranker` implementations (120 min)

- [ ] `packages/context-engine/src/retrieval/semantic-retriever.ts` (§2.1).
- [ ] `packages/context-engine/src/retrieval/semantic-ranker.ts` — wraps the retriever + applies the same target-file rule (§5.1: re-rank must leave target files intact).

### 3.2 Shadow path + comparison record (90 min)

- [ ] `packages/context-engine/src/retrieval/shadow.ts` (§2.2).
- [ ] Migration `0112_shadow_rank.sql` (§2.4) + a `ShadowRankWriter`.

### 3.3 The shadow flag (30 min)

- [ ] `semanticShadowEnabled` — per-project flag (default false) in `ContextPolicy`/config, ADMIN-togglable. Off everywhere except the demo + A/B harness.

### 3.4 Tests (150 min)

- [ ] **Invariant test**: after `resolveWithShadow` with the flag ON, the returned snapshot's `rank_method === 'keyword'` (the semantic result appears only in `shadow_rank_comparisons`).
- [ ] **Default-off test**: flag OFF → zero `embed` calls and no `shadow_rank_comparisons` row.
- [ ] Freshness: a stale vector (hash mismatch) is excluded from semantic candidates.
- [ ] Target-file rule: semantic re-ordering never removes the task's target files (Spec 4 §6 invariant).
- [ ] `rank_correlation` computed and stored for a fixture with known overlap.

### 3.5 Boundary + wiring (30 min)

- [ ] Register `TOKENS.SemanticRetriever`/`SemanticRanker` in DI (not in the default resolve path); `docs/architecture/wiring-map.md`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/retrieval/{semantic-retriever,semantic-ranker,shadow}.ts` | Semantic + shadow path |
| `packages/db/migrations/0112_shadow_rank.sql` | `shadow_rank_comparisons` |
| `packages/context-engine/src/__tests__/semantic-shadow.test.ts` | Invariant + default-off + freshness tests |

---

## 5. Acceptance Criteria

- [ ] `resolveWithShadow` (flag ON) returns a snapshot with `rank_method === 'keyword'` **always** — semantic rank appears only in `shadow_rank_comparisons`.
- [ ] Flag OFF: zero `embed` calls, zero comparison rows (proves shadow is inert by default).
- [ ] `grep -rn "rank_method *=" packages/context-engine/src` shows the only default assignment is `'keyword'`; the string `'semantic'` appears only in the shadow record path.
- [ ] Stale vectors (hash mismatch) are excluded from semantic candidates.
- [ ] Semantic re-ranking never drops a target file (target-file rule preserved).
- [ ] A run over a fixture writes a `shadow_rank_comparisons` row with non-null `keyword_order`, `semantic_order`, `rank_correlation`.
- [ ] `pnpm --filter @harness/context-engine test` green; `pnpm lint` green; no engine imports another engine.

---

## 6. Notes & Pitfalls

- **The served `rank_method` must never flip.** The whole week exists to measure semantic ranking *without* changing behavior. A single line that returns the semantic snapshot instead of the keyword one is the entire failure mode, compressed. The §2.3 assertion is the tripwire.
- **Shadow is not "run semantic and if it looks better, use it".** It is "run both, serve keyword, log both." Any temptation to score the semantic result *into* the live path is Phase-3 work and must be gated by the A/B harness (Day 29) first.
- **Kendall on top-k, not full permutation.** Comparing full orderings against a 10k-source index is expensive and misleading; correlate only the top-k (the items that would actually be injected). State k in the record.
- **The freshness guard belongs in the retriever query, not in a nightly sweep.** A WHERE `embedding_hash = content_hash` is the only way to guarantee a query never reads a stale vector — the listener (Day 17) is a latency optimization, the guard is correctness.
- **Semantic and keyword won't agree, and that's the point.** Low `rank_correlation` is data (semantic is finding different things), not a bug. Treat disagreement as the input to Day 29's head-to-head, not something to tune away.
- **Next (Day 19):** exact tokenizer (tiktoken / provider-specific) replaces `chars/4`, updating the budget trimmer against the same invariant.

---

*Prev: [Day 17 — Index Population: Embed Sources/Artifacts, Re-embed on Change](day-17.md) | Next: [Day 19 — Exact Tokenizer: tiktoken Replaces `chars/4`](day-19.md)*
