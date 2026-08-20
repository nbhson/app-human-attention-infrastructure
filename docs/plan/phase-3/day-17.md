# Day 17 — Re-rank: Dependency/Recency/Usage Heuristics over Fused Top-N

| | |
|---|---|
| **Week** | 4 — Hybrid context default |
| **Spec refs** | Spec 4 §5.1 (re-rank as a bounded, audit-logged stage; target-file rule intact), §5.2.2 (lost-in-the-middle) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 16 (hybrid retriever + RRF fusion behind `Retriever`) |

---

## 1. Objectives

By end of day you will have:

1. A **re-rank stage** that takes the fused top-N and re-orders using **dependency proximity, recency, and usage** heuristics (Spec 4 §5.1 "dependency/recency/usage").
2. The re-rank **bounded to top-N** (never the full index) and **audit-logged** — the re-ranked order is recorded in `ContextSnapshot` metadata so Spec 11 can measure whether re-ranking changed agent use.
3. The **target-file rule preserved** (Spec 4 §6 priority: never remove the target file) as a structural guarantee through re-rank.
4. Re-rank as an optional, budget-capped stage with an optional cross-encoder/LLM path stubbed but not required today.

Re-rank is the "lost-in-the-middle" defense (Spec 4 §5.2.2): highest-value items must sit at the head, not mid-prompt.

---

## 2. Design Decisions

### 2.1 Re-rank pipeline (position after fusion, before budget trim)

```text
HybridRetriever (fused, rank-ordered)
   ▼
ReRanker — re-order top-N by heuristic score   ← TODAY
   ▼
(optional) CrossEncoder/LLM-as-judge re-rank    ← stub today, Week 6 judge reuses
   ▼
Budget trim (Context §6)                         ← existing, unchanged
   ▼
ContextSnapshot
```

### 2.2 Heuristic re-rank score

```typescript
// packages/context-engine/src/retrieval/re-ranker.ts
export interface ReRankSignals {
  dependencyProximity: number;   // 1 if directly imported/referenced by target files, decays with graph distance
  recency: number;               // git-history / last-modified recency, exp-decayed
  usage: number;                 // historical usage in similar tasks (Phase 2 decision log / Memory retrieved_count)
}

export class HeuristicReRanker implements ReRanker {
  async reRank(candidates: RetrievedDoc[], targetFiles: string[]): Promise<RetrievedDoc[]> {
    // score' = w_dep·dependencyProximity + w_rec·recency + w_usage·usage   (w = 0.5/0.3/0.2 initial)
    // re-order only the top-N (default N=30). Candidates below N retain fused order (stable).
  }
}
```

- Weights start `w_dep=0.5, w_rec=0.3, w_usage=0.2` — **placeholder**, exposed as named constants so Day 32 (learn ranking params from usefulness) can fit them.
- `dependencyProximity` reuses Day 12's graph: proximity = `1 / (1 + graphDistance(target, source))` (0 when no path).

### 2.3 Bounded + audit-logged (Spec 4 §5.1 mandates both)

```typescript
interface ReRankMetadata {
  reRanked: boolean;
  topN: number;
  before: string[];     // fused order (sourceIds)
  after: string[];      // re-ranked order
  weights: { dep: number; rec: number; usage: number };
  targetFilesKept: boolean;   // asserts the target-file rule survived
}
```

Store `ReRankMetadata` into the `ContextSnapshot.metadata` (there's already a metadata map, Spec 4 §2.2). Spec 11 (Week 6) reads `before` vs `after` to evaluate whether re-ranking actually moved things agents used.

### 2.4 Target-file rule is re-rank's hard invariant

Re-rank must **never demote a target file out of the top, nor below the budget cutoff**. Enforce by pinning `targetFiles` to the head of the final order (re-ranked among themselves, but always above everything else). This structuralizes Spec 4 §6's "never remove the target file" rule; add a post-condition assert `targetFilesKept === true`.

### 2.5 Optional cross-encoder / LLM re-rank (stub)

A `CrossEncoderReRanker` or `LLMReranker` is the Spec 4 §5.1 "cross-encoder / LLM-as-judge, optional" extension. Stub the interface today; the LLM-as-judge *content* lands on Day 28 and can be reused here behind the same `ReRanker` interface. Do not build prompt scoring now.

---

## 3. Tasks

### 3.1 `ReRanker` interface + `HeuristicReRanker` (120 min)

- [ ] `packages/context-engine/src/retrieval/re-ranker.ts` — interface + heuristic impl (§2.2).
- [ ] Dependency proximity via `ClosureGraph` (Day 12) — inject, don't import `code-index` directly (use a `DependencyProximity` interface resolved in DI).

### 3.2 Re-rank integration + metadata (90 min)

- [ ] Insert re-rank between fusion and budget trim in the resolution pipeline.
- [ ] Persist `ReRankMetadata` (§2.3) into snapshot metadata.
- [ ] Top-N bound (default 30) and stable ordering below N.

### 3.3 Target-file pinning (45 min)

- [ ] Pin target files to the head; post-condition assert `targetFilesKept`.
- [ ] Test: a target file that fused at rank 8 is re-ranked to rank 1, never dropped.

### 3.4 Optional cross-encoder stub (30 min)

- [ ] `CrossEncoderReRanker` interface + no-op/false path behind a flag (`rerank.cross_encoder=false`).

### 3.5 Tests (120 min)

- [ ] Fused order vs re-ranked order differ on a dependency-close fixture; `before`/`after` recorded.
- [ ] `dep=0.5/rec=0.3/usage=0.2` weights sum to 1.0.
- [ ] Top-N bound respected (candidates below N keep fused order).
- [ ] Target-file rule survives re-rank in all fixtures.
- [ ] Snapshot metadata contains the re-rank metadata (Evaluator-visible).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/retrieval/re-ranker.ts` | `ReRanker`, `HeuristicReRanker`, metadata types |
| `packages/context-engine/src/retrieval/target-pin.ts` | Target-file pinning post-condition |
| `packages/context-engine/src/__tests__/re-rank.test.ts` | Re-rank ordering/bound/audit tests |
| `apps/api/src/bootstrap.ts` (updated) | Re-ranker + dependency-proximity wiring |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/context-engine test` — all tests pass.
- [ ] Re-rank re-orders only top-N (default 30); below-N order is stable (fused).
- [ ] `dependencyProximity` from the Day 12 graph influences ordering (fixture-proven).
- [ ] Target files are pinned to the head and never dropped (post-condition asserted).
- [ ] `ContextSnapshot.metadata` carries `before`/`after`/`weights`/`topN` for Spec 11 evaluation.
- [ ] Weights are named constants (`0.5/0.3/0.2`) ready for Day 32 fitting.
- [ ] Optional cross-encoder path is stubbed behind a false flag (no prompt scoring today).
- [ ] `pnpm lint` clean; no direct `code-index` import in `context-engine`.

---

## 6. Notes & Pitfalls

- **Re-rank touches only the top-N.** Spec 4 §5.1 is explicit: re-rank never the full index. Re-ranking the full corpus is (a) expensive and (b) defeats the point — the tail is budget-trimmed anyway.
- **Record `before`/`after` or re-rank is unevaluable.** Without the pre/post order in metadata, Day 32/39 cannot tell whether re-ranking actually helped. This is the measurement seam, not bookkeeping.
- **Target-file pinning is not negotiable.** If re-rank drops or demotes the target file, the context is useless to the task. Make it an assertion that fails the snapshot (hard fail in the §5.2.4 validation gate), not a soft warning.
- **Weights are placeholders — say so.** `0.5/0.3/0.2` is a starting guess. Spec 4 §5 flags all initial weights as tuneable; name them as a single config voice so Day 32 fits them from usefulness without a refactor.
- **Dependency proximity needs a fallback for no-path.** A source with no graph path to any target file gets proximity 0 — it should not be *penalized* into oblivion, just ranked on recency/usage. Guard against returning all-zero scores.
- **Tomorrow (Day 18):** RAG Fusion (multi-query + reciprocal ranking) behind `Retriever` (Spec 4 §5.2.5).

---

*Prev: [Day 16 — Hybrid Retriever as Default: BM25 Lexical + Embedding Semantic Fused](day-16.md) | Next: [Day 18 — RAG Fusion: Multi-query + Reciprocal Ranking behind Retriever](day-18.md)*
