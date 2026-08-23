# Day 16 — Review-memory Model: Reviews/Findings/Decisions Tiers

| | |
|---|---|
| **Week** | 4 — Review memory |
| **Spec refs** | Spec 9 §3–§4 (memory tiers + lifecycle, review-shaped); Phase-3 README §3 (Memory anchor), §4 |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 15 (W3 checkpoint); Phase-2 evidence store + `pgvector`/`Embedder` (shadow) live |

---

## 1. Objectives

By end of day you will have:

1. A new `packages/memory` (`@harness/memory`) with a **review-shaped** tier model: `REVIEW`, `FINDING`, `DECISION`, `PROJECT` — not the legacy generation/session/task tiers.
2. A `MemoryEntry` domain model (curated summary + `sourceEvidence` + confidence + retrieval counters), plus the `supersedes` version-chain field laid now.
3. Postgres schema (`memory_entries` + `memory_entry_evidence`) through `@harness/db`.
4. DI registration (`TOKENS.MemoryStore`) + architecture test proving the boundary (memory never imports an engine).

This day establishes the model + storage seam; Days 17–19 build ingestion, retrieval, and lifecycle. Memory here is **past reviews, findings, and decisions** for the *next* review — never code-generation state.

---

## 2. Design Decisions

### 2.1 Four review-shaped tiers, one table

```typescript
// packages/domain/src/memory.ts
export const MemoryKind = {
  REVIEW:   'REVIEW',    // a distilled past review: what changed, what was flagged, outcome
  FINDING:  'FINDING',   // a recurring review finding: a defect pattern, its severity, how often seen
  DECISION: 'DECISION',  // a human decision + rationale: approve/reject + why, reusable guidance
  PROJECT:  'PROJECT',   // durable project context: conventions, risk hotspots, owners
} as const;
export type MemoryKind = typeof MemoryKind[keyof typeof MemoryKind];
```

One `memory_entries` table with a `kind` discriminator (retrieval scores across kinds at once; a per-tier table split would make every relevance query a special case). `metadata jsonb` holds kind-specific fields.

### 2.2 `MemoryEntry` shape

`{ id, kind, content, sourceEvidence[], confidence, retrievedCount, lastRetrievedAt, expiresAt, supersedes }` — `content` is the curated, searchable summary (not raw log); `sourceEvidence` links back to the evidence/event rows that produced it; `supersedes` forms the version chain for Day 17's versioned append.

### 2.3 The ≥1 evidence invariant

A `MemoryEntry` cannot exist without ≥1 `sourceEvidence` link. Enforce at write time (`MemoryStore.create` rejects empty) and filter at read time. This mirrors the review-slice's "every PASSED report has evidence" invariant.

### 2.4 Boundary rule

`@harness/memory` imports only `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`. It is **consumed by** Context/Attention via the event bus + a DI-registered resolver — never by direct engine import. Add `memory` to the boundary config + architecture test.

---

## 3. Tasks

### 3.1 Scaffold (30 min)

- [ ] `packages/memory/package.json` (`@harness/memory`), `tsconfig`, boundary entry; deps domain/event-bus/db/di.

### 3.2 Domain types (45 min)

- [ ] `packages/domain/src/memory.ts` — `MemoryKind` (4 members), `MemoryId`, `MemoryEntry`.
- [ ] Unit test: `MemoryKind` has exactly the four review-shaped kinds.

### 3.3 Schema + migration (45 min)

- [ ] `packages/db/src/schema/memory.ts` — `memory_entries`, `memory_entry_evidence`; self-FK on `supersedes`.

### 3.4 `MemoryStore` core (120 min)

- [ ] `create/getById/listByKind`; `create` enforces ≥1 evidence + publishes `memory.entry_created`.

### 3.5 DI + boundary (45 min)

- [ ] `TOKENS.MemoryStore` registration; architecture test + grep check.

### 3.6 Tests (60 min)

- [ ] create persists; empty evidence throws; getById returns links; listByKind filters; event published.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/memory/package.json` + `src/index.ts` | New `@harness/memory` package |
| `packages/domain/src/memory.ts` | `MemoryKind`, `MemoryId`, `MemoryEntry` |
| `packages/db/src/schema/memory.ts` | `memory_entries` + `memory_entry_evidence` |
| `packages/memory/src/memory-store.ts` | `MemoryStore.create/getById/listByKind` |
| `packages/memory/src/__tests__/*.test.ts` | Domain + store + boundary tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/memory test` — green.
- [ ] `MemoryKind` = { REVIEW, FINDING, DECISION, PROJECT } — exactly four, no code-gen/session tiers.
- [ ] `memory_entries` + `memory_entry_evidence` exist; `supersedes` self-FK laid.
- [ ] Empty `sourceEvidence` create throws; retrieval filters zero-link entries.
- [ ] `memory.entry_created` published with `kind` + id.
- [ ] `grep -r "from '@harness" packages/memory/src` shows only `@harness/{domain,event-bus,db,di}`.

---

## 6. Notes & Pitfalls

- **No `TASK`/`SESSION` tiers.** Those belonged to the retired code-generation plan — dead in the review-reorient. Do not reintroduce them; the architecture test pins the four review-shaped kinds.
- **`content` is the searchable unit**, so it must be distilled, not raw diff text — Day 17 owns that distillation.
- **`supersedes` laid now** avoids a Day-17 migration; don't implement the write-back logic yet.
- **Day 17:** ingestion — evidence → distillation → versioned append.

---

*Next: [Day 17 — Memory Ingestion: Evidence → Distillation → Versioned Append](day-17.md)*