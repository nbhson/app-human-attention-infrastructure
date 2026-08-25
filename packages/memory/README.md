# @harness/memory — Review Memory, Retrieval & Lifecycle

Distills past reviews, findings, and decisions into curated, evidence-backed
memory; retrieves it relevance-scored for the next review; and runs its
lifecycle (consolidate → decay → archive).

**Status:** complete (as-built) ·
**Boundary rule:** imports only `@harness/domain`, `@harness/event-bus`, `@harness/db`,
`@harness/di` (R16); consumed by context/attention via the event bus, never by a sibling engine import.

---

## Purpose

1. **Store curated memory** — `MemoryStore.create` writes an entry + its evidence
   links atomically, then publishes `memory.entry_created`.
2. **Enforce provenance** — an entry cannot exist without ≥1 `sourceEvidence` link
   (`EmptySourceEvidenceError` on a link-less write).
3. **Distill deterministically** — `MemoryDistiller` maps stored review/decision
   rows to candidate entries with no LLM / I/O / clock (no fabrication).
4. **Version-append** — a refreshed entry chains off the one it replaces via
   `supersedes`, never mutating history.
5. **Retrieve relevance-scored** — `MemoryRetriever` ranks head-of-chain entries by
   lexical + confidence + recency + popularity.
6. **Run the lifecycle** — consolidate chains → decay confidence → archive the
   below-threshold (`MemoryLifecycle.tick`).

## Tiers

| Kind | What it is |
| --- | --- |
| `REVIEW` | a distilled past review — what changed, what was flagged, the outcome. |
| `FINDING` | a recurring defect pattern with severity + frequency. |
| `DECISION` | a human approve/reject + rationale, reusable guidance. |
| `PROJECT` | durable project context — conventions, risk hotspots, owners. |

## Pipeline

```text
   review.report_created / review.decision_submitted (event bus)
            │
            ▼
   MemoryIngestor  ── load rows → materialize `evidence` → MemoryDistiller
            │
            ▼
   MemoryStore.create   (entry + evidence links, atomically)
            │
            ▼
   memory.entry_created  ──▶  MemoryRetriever (read)  ──▶  MemoryContextResolver
                                                              │
                                                              ▼
                                                       context snapshot (memory section)
```

- **Write half** (`MemoryIngestor` → `MemoryDistiller` → `MemoryStore`) subscribes to
  the review surface's events; it is not bound at server boot today — it is wired by
  the `pnpm demo:memory` script and the `@harness/memory` unit suite (see the wiring map).
- **Read half** (`MemoryRetriever` behind the domain `MemoryProvider` seam) is fully
  container-wired via `MemoryContextResolver`.

## Retrieval ranking

```
relevance = 0.5·lexical + 0.2·confidence + 0.2·recency + 0.1·popularity
```

`MemoryRetriever` returns only the **head of each version chain**, bumps access
counters fire-and-forget (so the read path never blocks on the write), and — with an
empty query — degrades to recency + confidence.

## Lifecycle

| Stage | What it does |
| --- | --- |
| `consolidate` | fold a supersede chain into one head entry. |
| `decay` | fade `confidence` toward its per-entry `confidence_floor` with age. |
| `archive` | mark an entry `ARCHIVED` (soft-delete, retained for audit) below the utility threshold. |

`archiveBelowThreshold` writes all stale rows in **one batched** `UPDATE … WHERE id IN
(…)` (a single round-trip instead of one per row) and still publishes one
`memory.archived` event per row — the write collapses, the provenance never does.

`MemoryLifecycle.tick()` runs the three in dependency order; `MemoryLifecycleScheduler`
wraps it on a timer (`DEFAULT_LIFECYCLE_INTERVAL_MS` = hourly).

## Modules

| Module | What it provides |
| --- | --- |
| `types.ts` | `CreateMemoryInput`, `EmptySourceEvidenceError`. |
| `memory-store.ts` | `MemoryStore` — `create` / `getById` / `listByKind` / `recordAccess`. |
| `memory-distiller.ts` | deterministic evidence → curated-candidate extraction. |
| `versioned-append.ts` | dedup-keyed, `supersedes`-chained append + confidence. |
| `memory-ingestor.ts` | event-bus subscriber grounding each entry in evidence. |
| `chain-resolve.ts` | `resolveChainHeads` (supersede-chain → head). |
| `memory-retriever.ts` | lexical + confidence + recency + popularity rank. |
| `lifecycle/*` | `consolidate`, `decay`, `archive`, `scheduler`. |

## Directory structure

```
src/
├── index.ts
├── types.ts
├── memory-store.ts / memory-distiller.ts / versioned-append.ts
├── memory-ingestor.ts / chain-resolve.ts / memory-retriever.ts
└── lifecycle/   # consolidate, decay, archive, scheduler
```

## Public API surface

```typescript
// CreateMemoryInput, EmptySourceEvidenceError,
// MemoryStore, MemoryDistiller, MemoryIngestor, MemoryRetriever,
// resolveChainHeads, appendVersion, MemoryLifecycle, MemoryLifecycleScheduler
```

## Dependency rule

```
packages/memory → @harness/domain, @harness/event-bus, @harness/db, @harness/di
              → never a sibling engine (served through the event bus + the domain MemoryProvider seam)
```

`memory_entries` is the store table; `memory_entry_evidence` is the append-only,
many-to-many binding back to `evidence` (idempotent by UNIQUE `(memory_entry_id, evidence_id)`).