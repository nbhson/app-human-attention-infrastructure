# Day 20 — Context Engine: collect → rank → budget (for the reviewer)

| | |
|---|---|
| **Week** | W3 — Trust pipeline |
| **Spec refs** | Spec 4 §1–2 (context collection + ranking/budgeting), Spec 1 §3 |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 19 (routing + scores + evidence available) |

---

## 1. Objectives

- Build `@harness/context-engine` as the single seam that assembles **what the reviewer sees**: diff, requirement, findings so far, and verification evidence.
- Implement the pipeline **collect → rank → budget**: gather candidate context, rank by relevance, then fit within a token budget.
- Ensure the reviewer consumes this context bundle (not arbitrary DB reads), so the review prompt is reproducible and bounded.
- Keep ranking deterministic in Phase 1 (priority signals: file kind, severity, recency); semantic/embedding ranking is Phase 2+.

## 2. Design Decisions

- Context is built *for the reviewer* and never mutated by it. The engine renders a `ContextBundle` the `ReviewAgent` prompt consumes verbatim.

```ts
export interface ContextBundle {
  readonly correlationId: string;
  readonly requirement?: Requirement;
  readonly diff: Diff;                      // ranked hunks within budget
  readonly findingsSoFar: ReviewFinding[];  // prior-review findings (if any)
  readonly evidence: EvidenceSummary[];     // verification results
  readonly budget: { used: number; limit: number };
}
```

- **Budgeting** is hard: items over the limit are truncated with an explicit `truncated: true` marker, never silently dropped — the reviewer must know its context is partial.

## 3. Tasks

### 3.1 Collectors (150 min)
- [ ] `context/collectors/*` — diff, requirement, findings, evidence collectors
- [ ] `context/context-engine.ts` — assembly entrypoint

### 3.2 Ranker + budget (180 min)
- [ ] `context/ranker.ts` — deterministic ranking (severity/file-kind/recency)
- [ ] `context/budget.ts` — token estimation + truncation with `truncated` flags

### 3.3 Tests (90 min)
- [ ] Ordering, budget-truncation, and determinism tests; context-bundle snapshot

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/context-engine.ts` | Collect → rank → budget entrypoint |
| `packages/context-engine/src/ranker.ts` | Deterministic ranker |
| `packages/context-engine/src/budget.ts` | Token budget + truncation |
| `packages/context-engine/src/collectors/index.ts` | Context collectors |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/context-engine test` passes
- [ ] The bundle ranks higher-severity findings/evidence first and respects the token limit
- [ ] Over-budget context is truncated with an explicit `truncated: true`, never silently omitted
- [ ] Same inputs produce the same `ContextBundle` (deterministic)

## 6. Notes & Pitfalls

- This is a ranking/budgeting seam, not a retrieval system — no embeddings or vector search in Phase 1 (Phase 2+).
- The bundle is an input to `ReviewAgent`; Day 21 wires and freshness-checks it end-to-end.

---

*Next: [Day 21 — Week 3 checkpoint — context delivery, freshness check](day-21.md)*