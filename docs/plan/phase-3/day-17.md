# Day 17 — Memory Ingestion: Evidence → Distillation → Versioned Append

| | |
|---|---|
| **Week** | 4 — Review memory |
| **Spec refs** | Spec 9 §3.2 (evidence invariants, supersedes), §4 (lifecycle); Phase-3 README §3 (Memory anchor) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 16 (`MemoryStore` + tiers + schema) |

---

## 1. Objectives

By end of day you will have:

1. An **ingestion pipeline**: review/decision/event evidence → a distilled, curated `content` summary → a versioned `MemoryEntry` append.
2. A `MemoryDistiller` that turns raw evidence (a completed review + its findings + decision) into a concise summary — the *curated* content, not the raw log.
3. **Versioned append** via `supersedes`: a refreshed distillation of the same memory idea creates a new entry chaining the old (Git-like), never an in-place overwrite.
4. Ingestion triggered from review/decision events without the memory package importing the review engine (event-bus subscription).

This makes review memory *come from real outcomes*; Day 18 retrieves it.

---

## 2. Design Decisions

### 2.1 Distillation is the "curated summary" step

`MemoryDistiller.distill(evidence): DistilledMemory[]` maps a completed review → candidate entries: one `REVIEW` (what changed + outcome), zero-or-more `FINDING` (recurring defect patterns, each with confidence), and a `DECISION` when a human decided (rationale distilled for reuse). LLM assistance is optional behind `LLMProvider`; the default is a deterministic extractor — distillation must not fabricate, so it derives from evidence fields.

### 2.2 Versioned append, not edit-in-place

On re-distillation of the same memory idea (same `dedup_key` = hash of kind + subject), create a new `MemoryEntry` with `supersedes → prior.id`, bumping `confidence` from how often the pattern recurred. History is preserved; readers follow the chain (Day 18 resolves the head).

### 2.3 Ingestion subscriber

`MemoryIngestor` subscribes to `review.completed` / `decision.recorded` via the event bus and calls the distiller → store. No direct import of `@harness/review`; the event contract is the seam.

### 2.4 Enforce evidence-link invariant on every append

Every appended entry cites its `sourceEvidence` (the review/decision/event rows); a distilled entry with no backing evidence is rejected (Day 16 invariant carried through).

---

## 3. Tasks

### 3.1 Event-bus subscription (45 min)

- [ ] `MemoryIngestor` subscribes to review/decision events; maps payloads to evidence refs.

### 3.2 `MemoryDistiller` (120 min)

- [ ] Deterministic distill: REVIEW/FINDING/DECISION candidates + `content` summaries + confidence.

### 3.3 Versioned append (90 min)

- [ ] `appendVersion` — dedup key → supersedes chain → bump confidence → store.

### 3.4 Ingestion flow (60 min)

- [ ] Wire subscriber → distiller → versioned append; reject no-evidence entries.

### 3.5 Tests (75 min)

- [ ] Completed review produces REVIEW + FINDING entries; decision produces DECISION.
- [ ] Re-ingestion creates a superseding entry (chain), no in-place edit.
- [ ] Confidence bumps on recurrence; no-evidence rejected.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/memory/src/memory-distiller.ts` | Evidence → curated entries |
| `packages/memory/src/memory-ingestor.ts` | Event subscriber → ingest |
| `packages/memory/src/versioned-append.ts` | Dedup → supersedes chain + confidence |
| `packages/memory/src/__tests__/ingestion.test.ts` | Ingestion + versioning tests |

---

## 5. Acceptance Criteria

- [ ] A completed review ingests into REVIEW + FINDING (+ DECISION on decision) entries with evidence links.
- [ ] Re-ingesting the same idea appends a new version via `supersedes` (chain), never overwrites.
- [ ] `confidence` reflects recurrence; entries always cite ≥1 evidence.
- [ ] Ingestion reaches memory via the event bus — no `@harness/review` import in `@harness/memory`.
- [ ] `pnpm --filter @harness/memory test` green.

---

## 6. Notes & Pitfalls

- **Distill from evidence, not from the reviewer's prose alone.** A summary that paraphrases the model's *claims* without grounding inherits hallucination; anchor on stored findings/decisions/results.
- **The dedup key defines "same idea".** Hash `kind + subject` (e.g. the finding signature or decision topic), not the raw text — minor wording changes must not split the version chain.
- **Confidence is signal, not vibes.** Bump on corroborating recurrence, decay on absence (Day 19). Never set 1.0 by fiat.
- **Day 18:** retrieval — relevance scoring, served to Context.

---

*Next: [Day 18 — Memory Retrieval: Relevance Scoring, Served to Context](day-18.md)*