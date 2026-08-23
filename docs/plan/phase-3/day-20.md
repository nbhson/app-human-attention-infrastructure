# Day 20 — Week 4 Checkpoint: Review Memory Write + Read Demonstrable

| | |
|---|---|
| **Week** | 4 — Review memory |
| **Spec refs** | Phase-3 README §5 (W4 milestone), §7 (review memory exit criterion) |
| **Estimated effort** | 5h |
| **Prerequisites** | Days 16–19 (tiers, ingestion, retrieval, lifecycle) |

---

## 1. Objectives

By end of day you will have:

1. A demonstrable Week-4 milestone: **write a review outcome into memory and read it back, relevance-scored, into the next review's context.**
2. An end-to-end demo: ingest one completed review → retrieve top-K for a new review → show the memory section in the assembled context + its relevance scores.
3. Lifecycle demonstrated live: consolidate a chain, decay an unused entry, archive a superseded one.
4. W4 evidence in `docs/retros/`; wiring map notes the memory seam + token.

The checkpoint proves review memory is *closed* — write, read, and lifecycle all working together.

---

## 2. Design Decisions

### 2.1 The demo is a write→read round-trip, not a simulated store

`scripts/demo-memory.ts` uses the real pipeline: emit a completed-review event → wait for ingestion → retrieve for a candidate review → assert the retrieved `REVIEW`/`DECISION` entries surface with evidence links and nonzero relevance. No fixtures that sidestep the event bus.

### 2.2 "Demonstrable" = the memory changed the context

The checkpoint's bar is that the top-K memory section is **present and non-empty** in the assembled reviewer context for a new review touching the same subject. A memory store that writes but never surfaces is a write-only box, not memory.

### 2.3 Keep it honest: relevance, not vibes

Print the relevance scores + the signals behind them (confidence, recency, match), so the demo is auditable — the reviewer can see *why* a memory surfaced, not just that one did.

---

## 3. Tasks

### 3.1 End-to-end demo (90 min)

- [ ] `scripts/demo-memory.ts` — write (event → ingest) → read (retrieve → context) → print scores.

### 3.2 Lifecycle demo (45 min)

- [ ] Show consolidate + decay + archive on the ingested data; assert archived excluded from retrieval.

### 3.3 Integration debt pass (60 min)

- [ ] Evidence-link invariant verified through ingestion; head-of-chain retrieval verified; async counters flushed before read-back assertions.

### 3.4 Docs + evidence (45 min)

- [ ] `docs/architecture/wiring-map.md` — `TOKENS.MemoryStore`/`MemoryRetriever`, `@harness/memory`.
- [ ] `docs/retros/phase3-w4.md` — recorded demo output.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo-memory.ts` | Write→read memory demo |
| `docs/architecture/wiring-map.md` (updated) | Memory seam + tokens |
| `docs/retros/phase3-w4.md` | Week 4 checkpoint evidence |

---

## 5. Acceptance Criteria

- [ ] `pnpm demo:memory` ingests a review → retrieves top-K into a new review's context with non-empty memory section.
- [ ] Relevance scores printed with their signals (match/confidence/recency).
- [ ] Lifecycle: consolidation, decay, and archive all demonstrated; archived excluded from retrieval.
- [ ] Ingested entries all cite ≥1 evidence.
- [ ] `pnpm test && pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Wait for async ingestion before reading back.** Event→ingest→store is asynchronous; a demo that reads before the entry lands shows a false miss. Flush/poll before asserting.
- **The memory must change the context, not just exist.** If top-K doesn't actually influence the reviewer's attention/context, that's Week 7's feedback loop — flag it, don't paper over it today.
- **Week 5 pivots to review-quality calibration** (LLM-as-judge). Memory is now stable; don't refactor it mid-phase.
- **Next (Day 21):** LLM-as-judge on review reports — severity/routing rubric.

---

*Next: [Day 21 — LLM-as-judge on Review Reports: Severity/Routing Rubric](day-21.md)*