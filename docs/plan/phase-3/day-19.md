# Day 19 — Memory Lifecycle: Consolidation/Decay/Archive

| | |
|---|---|
| **Week** | 4 — Review memory |
| **Spec refs** | Spec 9 §4 (lifecycle rules); Phase-3 README §3 (consolidation/decay/archive), §7 |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 16–18 (tiers, ingestion, retrieval) |

---

## 1. Objectives

By end of day you will have:

1. **Consolidation** — merge many near-duplicate entries (same dedup idea, many versions) into a single head entry with aggregated confidence and evidence links.
2. **Decay** — `confidence`/relevance decays over time when a memory is not retrieved or corroborated, down to a floor (not to zero, so history is recoverable).
3. **Archive** — entries dropped below a utility threshold (or superseded beyond N versions) move to `ARCHIVED` and are excluded from retrieval but retained for audit.
4. A scheduled lifecycle job emitting `memory.consolidated` / `memory.archived` events.

Lifecycle keeps the memory store a *useful, current* signal, not an unbounded log.

---

## 2. Design Decisions

### 2.1 Lifecycle is scheduled + idempotent

`memory.lifecycle.tick` runs on a cadence (node-cron / a scheduled job), processes a bounded batch, and is idempotent — re-running a tick is a no-op for already-consolidated/archived entries.

### 2.2 Consolidation collapses chains

For a `supersedes` chain: keep the head, fold superseded versions' `sourceEvidence` links into the head's link set, aggregate `confidence` (e.g. max or weighted mean), and mark superseded entries `ARCHIVED`. Retrieval then serves one clean entry.

### 2.3 Decay as an exponential taper, floored

`confidence_t = max(floor, confidence_old · decayFactor^Δt)` where `Δt` is time since last corroboration/retrieval. Floor preserves the entry's history while demoting stale-but-unused memory.

### 2.4 Archive is soft-delete

`ARCHIVED` is a status, not a hard delete; retrieval excludes it, audit keeps it. A future "re-activate" is trivial.

---

## 3. Tasks

### 3.1 Lifecycle schema additions (30 min)

- [ ] Add `status` (`ACTIVE` | `ARCHIVED`) + `confidence_floor` to `memory_entries` (migration).

### 3.2 Consolidation (90 min)

- [ ] `consolidateChain` — fold versions → head; archive superseded; aggregate confidence + evidence.

### 3.3 Decay (60 min)

- [ ] `applyDecay` — exponential taper, floored; skip recently-retrieved entries.

### 3.4 Archive + scheduler (60 min)

- [ ] `archiveBelowThreshold`; cron job `memory.lifecycle.tick` + events.

### 3.5 Tests (75 min)

- [ ] Chain consolidation merges evidence + archives superseded; decay reduces confidence to the floor; archived excluded from retrieval; scheduler idempotent.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/memory/src/lifecycle/consolidate.ts` | Chain consolidation |
| `packages/memory/src/lifecycle/decay.ts` | Confidence decay |
| `packages/memory/src/lifecycle/archive.ts` | Archive below threshold |
| `packages/memory/src/lifecycle/scheduler.ts` | `memory.lifecycle.tick` job |
| `packages/db/migrations/0xxx_memory_lifecycle.sql` | `status` + `confidence_floor` |

---

## 5. Acceptance Criteria

- [ ] A multi-version chain consolidates to one head with merged evidence; superseded entries `ARCHIVED`.
- [ ] `confidence` decays over time to a non-zero floor; recently-retrieved entries skip decay.
- [ ] `ARCHIVED` entries excluded from retrieval, retained in audit.
- [ ] Lifecycle tick idempotent; emits `memory.consolidated`/`memory.archived`.
- [ ] `pnpm --filter @harness/memory test` green.

---

## 6. Notes & Pitfalls

- **Archive ≠ delete.** Hard-deleting memory destroys the audit trail the whole phase exists to protect; `ARCHIVED` retains it while removing noise.
- **Decay floor protects recoverability.** A floor of 0.0 turns decay into deletion; keep it positive and configurable.
- **Consolidation must merge evidence, not drop it.** Losing a `sourceEvidence` link in a merge breaks the ≥1-invariant provenance from Day 16.
- **Day 20** checkpoint: review-memory write + read demonstrable.

---

*Next: [Day 20 — Week 4 Checkpoint: Review Memory Write + Read Demonstrable](day-20.md)*