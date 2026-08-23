# Day 27 — RRF Fusion + Re-rank (Dependency/Recency/Usage)

| | |
|---|---|
| **Week** | 6 — Hybrid context default |
| **Spec refs** | Context §5.1–5.2 (fusion + re-rank); Spec 7 §5.2–5.3 (dependency graph signals) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 26 (hybrid + RRF); Day 14 `@harness/code-index` dependency graph |

---

## 1. Objectives

By end of day you will have:

1. A **re-rank stage** after RRF fusion: the fused top-N is re-ordered by **dependency proximity, recency, and usage** heuristics (not just retrieval score).
2. Dependency proximity reuses the Day-14 dependency graph (changed files → proximity-weighted candidates) via a seam.
3. Recency + usage signals (last-touched, retrieval popularity) fold into the final order.
4. The full pipeline: retrieve (hybrid) → fuse (RRF) → re-rank → budget trim → snapshot.

This makes the hybrid ranking *context-aware*; Day 28 adds RAG Fusion, Day 29 measures the cutover.

---

## 2. Design Decisions

### 2.1 Re-rank lives after fuse, before trim

Pipeline: `HybridRetriever → RRF top-N → ReRanker → trim`. The re-ranker never widens the candidate set (it only re-orders), so it keeps latency bounded and never resurrects a fused-out doc.

### 2.2 Three signals, additive

`final = w_rrf·rrf_norm + w_dep·dependencyProximity + w_rec·recency + w_use·usage` — weights start from Phase-2/2's keyword-ranker defaults and are *fit later* (Day 32). Dependency proximity comes from the code-index graph via `TOKENS.CodeIndex` seam; recency from file mtime; usage from retrieval counters.

### 2.3 Dependency signal is an injected seam

`context-engine` consumes `dependencyProximity(changedFiles, candidate)` through a DI-registered provider — it must not import `@harness/code-index` directly (context-engine is an engine; code-index is a data package). The seam keeps the boundary clean.

### 2.4 Missing signals are neutral, not zero-dropping

If the dependency graph is cold for a source, proximity falls to a neutral 0.5, never a hard drop — the RRF score still carries the candidate.

---

## 3. Tasks

### 3.1 Re-rank skeleton (60 min)

- [ ] `packages/context-engine/src/ranking/re-ranker.ts` — takes fused top-N, applies signal addends.

### 3.2 Dependency-proximity seam (90 min)

- [ ] `toKENS.CodeIndex` provider exposing `dependencyProximity(changedFiles, candidate)`; wire into re-ranker.

### 3.3 Recency + usage (60 min)

- [ ] Recency (mtime) + usage (retrieval counters) feature extraction.

### 3.4 Pipeline wiring (60 min)

- [ ] Insert `ReRanker` into `resolveContext` between RRF and trim.

### 3.5 Tests (75 min)

- [ ] Re-rank re-orders a fixture correctly; never widens the set; cold-graph neutral fallback; seam boundary grep.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/ranking/re-ranker.ts` | Re-rank stage |
| `packages/context-engine/src/ranking/signals.ts` | dependency/recency/usage features |
| `packages/di/src/tokens.ts` (updated) | `TOKENS.CodeIndex` seam |
| `packages/context-engine/src/__tests__/re-rank.test.ts` | Re-rank tests |

---

## 5. Acceptance Criteria

- [ ] Fused top-N re-ordered by dependency/recency/usage addends.
- [ ] Re-ranker never expands the candidate set.
- [ ] Dependency proximity consumed via a DI seam (no `@harness/code-index` import in context-engine).
- [ ] Cold-graph candidate ranks neutrally, not dropped.
- [ ] `pnpm --filter @harness/context-engine test` green.

---

## 6. Notes & Pitfalls

- **Re-rank re-orders, never recalls.** If you let the re-ranker add candidates, you've built a second retriever; keep its input set a pure subset of the fused top-N.
- **Weights are placeholders until Day 32 fits them.** Don't hand-tune the three addends into "looks right" — they're learned from usefulness.
- **Neutral fallback, not silent drop.** A missing graph entry shouldn't demote a good RRF match; document the 0.5 neutral as the documented behavior.
- **Day 28:** RAG Fusion behind `Retriever`.

---

*Next: [Day 28 — RAG Fusion behind `Retriever`](day-28.md)*