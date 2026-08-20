# Day 04 — Versioned Write-back: supersedes, Rollback, Forget/Update Cross-check

| | |
|---|---|
| **Week** | 1 — Memory store & retrieve |
| **Spec refs** | Spec 9 §4.4 (write-back & versioned memory: promotion revocable, current pointer), §3.2 (supersedes correction rule) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 03 (retrieval + relevance scoring, `MemorySignalSource` seam, retrieval counters) |

---

## 1. Objectives

By end of day you will have:

1. A **Git-like version log** for every memory idea: each update appends, `supersedes` chains, nothing mutates.
2. **Rollback** — promote a *previous* version back to "current" without deleting the bad write.
3. **Forget** — demote/withdraw a memory from the rank signal (revocable promotion, per §4.4), with a `forgotten_at` tombstone rather than a delete.
4. An **update cross-check**: every promotion/demotion verifies the version still has ≥ 1 evidence link, and a demotion can be reversed without breaking history.

This completes the closed-loop write path from Spec 9 §4.4 — *"promotion is revocable … because retrieval always reads current pointer, not the raw stream."*

---

## 2. Design Decisions

### 2.1 The version chain is the write log (not a separate audit table)

`memory_entries` rows are immutable. The chain:

```text
v1 (foo, confidence 0.6)  ← initial write (supersedes = NULL)
  ↑
v2 (foo, confidence 0.7)  ← curation write (supersedes = v1)
  ↑
v3 (foo, confidence 0.3)  ← contradiction write (supersedes = v2)
```

- **"Current"** = the head with no successor (retrieval reads this, per §4.4).
- **No `UPDATE` on `content`/`confidence`/`sourceEvidence`** — those are immutable columns. Only *counter/tombstone* columns (`retrieved_count`, `last_retrieved_at`, `promoted_at`, `forgotten_at`) may change.

Add these lifecycle columns today (migration): `promoted_at timestamptz NULL`, `forgotten_at timestamptz NULL`.

### 2.2 `writeBack` — the core API

```typescript
// packages/memory/src/write-back.ts
export class MemoryWriteBack {
  constructor(private readonly store: MemoryStore, private readonly bus: IEventBus) {}

  // Create or supersede: always appends a new version.
  async writeBack(input: WriteBackInput): Promise<MemoryEntry> {
    // 1. find head by content_key (Day 02 findHead)
    // 2. cross-check: union(sourceEvidence) non-empty (≥1 link) — else throw
    // 3. insert new version with supersedes = head?.id ?? null
    // 4. publish memory.entry_created { entryId, kind, supersedes }
  }

  // Rollback: re-promote a previous version to current.
  async rollback(contentKey: string, toVersionId: MemoryId): Promise<MemoryEntry> {
    // insert a NEW version whose content/sourceEvidence COPIED from toVersionId,
    // supersedes = current head. (Never "un-delete" — the bad head stays in history.)
  }

  // Forget: demote current head from the rank signal; revocable.
  async forget(contentKey: string, reason: string): Promise<void> {
    // set forgotten_at = now() on the head; publish memory.entry_forgotten
  }

  // Un-forget: revoke a demotion.
  async unforget(contentKey: string): Promise<void> {
    // clear forgotten_at on the head; publish memory.entry_restored
  }
}
```

**Rollback is a write, not a pointer flip.** Appending a copy as the new head keeps the audit chain append-only; flipping a `current` pointer would break the "immutable rows" rule and complicate the event log replay.

### 2.3 Promotion is data, not a boolean of the row (Spec 9 §4.4)

`promoted_at` on a row means "this version is eligible to be offered as a rank signal." Demotion (calibration, Day 31) sets `promoted_at = NULL` or writes a demotion marker — it does **not** delete. Because retrieval reads the current head, demotion applies instantly to future reads but history is untouched.

Promotion gates:
- `sourceEvidence` non-empty (structural).
- `confidence ≥ threshold` (heuristic — starts at 0.5; Day 31 calibrates).
- **Not** yet observing usefulness — that's Day 31's job; today just ensure the field exists and retrieval filters on it.

### 2.4 Cross-checks — what "forget/update" must verify (Spec 9 §4.4)

| Operation | Cross-check | Failure mode |
|-----------|-------------|--------------|
| `writeBack` | valid `kind`, content non-empty, union evidence ≥ 1 | `MissingEvidenceError` |
| `rollback` | `toVersionId` actually belongs to `contentKey`'s chain | `VersionChainError` |
| `forget` | head exists and has a successor OR came from evidence | `NothingToForgetError` |
| `unforget` | head currently `forgotten_at != NULL` | `NotForgottenError` |
| retrieve | skip rows where `forgotten_at != NULL` or `promoted_at IS NULL` | — |

### 2.5 Events (append to the audit trail)

- `memory.entry_created { entryId, kind, supersedes }` (existing — now mandatory `supersedes` field)
- `memory.entry_rolled_back { entryId, fromVersionId, toVersionId }`
- `memory.entry_forgotten { entryId, reason }`
- `memory.entry_restored { entryId }`

All carry `correlation_id` = the memory `content_key` (so the whole version chain is one correlation root).

---

## 3. Tasks

### 3.1 Migration: lifecycle columns (30 min)

- [ ] Add `promoted_at`, `forgotten_at` to `memory_entries` (nullable timestamptz). Generate + migrate.
- [ ] Add index on `promoted_at` (retrieval filters on it).

### 3.2 `MemoryWriteBack` service (150 min)

- [ ] `packages/memory/src/write-back.ts` — `writeBack`, `rollback`, `forget`, `unforget` (§2.2).
- [ ] `content_key` = stable hash of a normalized content signature (not the full text), stored as a column `content_key` (add to schema) so chains group correctly across paraphrases.

### 3.3 Retrieval respects promotion + tombstone (60 min)

- [ ] `retrieve()` filters: head-only, `promoted_at IS NOT NULL`, `forgotten_at IS NULL`, decayed-not-expired (Day 06 adds decay; today at least expiry).
- [ ] Update tests from Day 03 to seed `promoted_at` so existing assertions still pass.

### 3.4 Cross-check error types (45 min)

- [ ] `VersionChainError`, `NothingToForgetError`, `NotForgottenError`, `MissingEvidenceError` (reuse) in `errors.ts`.
- [ ] Each carries the offending ids for audit.

### 3.5 Tests (180 min)

- [ ] `writeBack` on a fresh key inserts head with `supersedes = NULL`.
- [ ] `writeBack` on an existing key appends v2 with `supersedes = v1.id`; v1 row is byte-identical after the write.
- [ ] `rollback` appends a new head copied from the target version; the erroneous head remains in history.
- [ ] `rollback` to a version outside the chain throws `VersionChainError`.
- [ ] `forget` sets `forgotten_at`; subsequent `retrieve` excludes the entry; `unforget` re-includes it.
- [ ] `writeBack` with empty union evidence throws `MissingEvidenceError`.
- [ ] All four events are published with correct payloads (spy on bus).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/memory/src/write-back.ts` | `MemoryWriteBack` service |
| `packages/memory/src/memory-store.ts` (updated) | head/chain queries, promotion filter |
| `packages/memory/src/errors.ts` (updated) | Cross-check error types |
| `packages/db/src/schema/memory.ts` + migration | `promoted_at`, `forgotten_at`, `content_key` |
| `packages/memory/src/__tests__/write-back.test.ts` | Rollback/forget/cross-check tests |
| `docs/architecture/wiring-map.md` (updated) | `MemoryWriteBack` registration |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/memory test` — all tests pass.
- [ ] Every `writeBack` appends; zero `UPDATE` statements touch `content`, `confidence`, or `sourceEvidence` (prove by search: only counter/tombstone columns are updatable).
- [ ] `rollback` produces a new head while preserving the full chain (audit query returns all versions).
- [ ] `forget` hides from retrieval but the row is recoverable via `unforget`.
- [ ] Retrieval returns only `promoted_at IS NOT NULL AND forgotten_at IS NULL` heads.
- [ ] Union-evidence cross-check prevents a zero-link write.
- [ ] `memory.entry_created`, `memory.entry_rolled_back`, `memory.entry_forgotten`, `memory.entry_restored` all emitted with `correlation_id = content_key`.
- [ ] `pnpm --filter @harness/memory build` + `pnpm lint` clean.

---

## 6. Notes & Pitfalls

- **Rollback ≠ DELETE.** The single most dangerous choice today is implementing rollback as an in-place revert or a hard delete. A "rolled back" memory must still be able to say *why* it was rolled back. Append a copy as the new head.
- **`content_key` vs raw `content`.** Grouping chains by exact text means "fix auth bug" and "fix authentication bug" never merge (that's Day 06 consolidation). But `content_key` by *exact* hash is correct for today: write-back chains must not silently attach to a paraphrase they don't literally extend.
- **Supersedes chains can get long.** Cap the audit surface, not the write: keep every version (audit), but retrieval only ever touches the head. If `supersedes_idx` queries degrade, add a `chain_length` denormalized counter later — do not truncate history.
- **Cross-check against evidence, not against other memory.** A forget/update must re-verify the *evidence* backing, not peer-compare against another entry. Peer comparison is consolidation (Day 06), a different operation with a different threshold.
- **Promotion threshold is a placeholder today.** 0.5 is arbitrary. Day 31 fits it. Do not rename or hide the constant — make it a named, single-source value so calibration can swap it.
- **Tomorrow (Day 05):** Week 1 checkpoint — memory write + read demonstrable end to end.

---

*Prev: [Day 3 — Memory Retrieval: Relevance Scoring Served to Context](day-03.md) | Next: [Day 5 — Week 1 Checkpoint: Memory Write + Read Demonstrable](day-05.md)*
