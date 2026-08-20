# Day 07 — Archive (90d) + Expiration; Hot/Cold Tier

| | |
|---|---|
| **Week** | 2 — Memory lifecycle + trajectory |
| **Spec refs** | Spec 9 §4.5 (archive: unused ~90 days → cold storage), §5 (Phase boundaries: cold storage for old evidence) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 06 (consolidation: dedup/conflict/decay) |

---

## 1. Objectives

By end of day you will have:

1. An **archive path**: entries unused ~90 days move from the hot ranking set to cold storage (Spec 9 §4.5 — "entries unused for ~90 days move to cold storage, freeing ranking budget").
2. An **expiration path**: entries past their scheduled `expires_at` are retired (flagged, not deleted) and stop being offered.
3. A **hot/cold tier** split: retrieval queries hot only; audit queries can reach cold.
4. A **retention report** documenting how many entries/bytes moved, so the ranking-budget benefit is measurable.

This completes the managed lifecycle from Spec 9 §4.5 and the Phase-3 cold-storage note in §5.

---

## 2. Design Decisions

### 2.1 Archive = move the *pointer*, not the row

"Archive" does not delete. It flips a tier marker:

- Add `tier text NOT NULL DEFAULT 'hot'` (CHECK `tier IN ('hot','cold')`) and `archived_at timestamptz NULL`.
- The archive sweep sets `tier = 'cold'`, `archived_at = now()` for entries with `days_since_last_use ≥ 90` (computed like Day 06 decay) — mirroring Spec 5 §7's "last 10 generations stay hot / older to cold" philosophy.
- **Retrieval reads `tier = 'hot'` only.** Audit queries (chain view, provenance) read all tiers.

Cold entries can optionally be moved to a slower backing store later; today "cold" is a logical tier in the same Postgres table, which is sufficient and avoids an object-store dependency.

### 2.2 Expiration = tombstone, not delete

`expires_at` (set at write time, Day 01) is a hard retirement:

- Sweep sets `forgotten_at`-style tombstone (`expired_at timestamptz NULL`) for entries past `expires_at`.
- Expired entries are excluded from retrieval for good (unless explicitly restored via Day 04 `unforget`, which clears both tombstones).

**Difference from decay:** decay is weighted inactivity (reversible on use); expiration is a scheduled, content-level deadline. Both hide from ranking; neither deletes.

### 2.3 One sweep, three outcomes — `RetentionJob`

```typescript
export class RetentionJob {
  async run(): Promise<RetentionReport> {
    // archive(): tier='cold' WHERE days_since_last_use >= 90
    // expire():  expired_at = now() WHERE expires_at IS NOT NULL AND expires_at < now()
    // report():  { archivedCount, expiredCount, coldBytes, hotBytes }
  }
}
```

Order: archive sweep, then expire sweep (an expired entry should be flagged even if also archive-eligible).

### 2.4 Hot/cold query separation

```sql
-- retrieval (hot path): only hot, only current, only promoted, not forgotten/decayed/expired
SELECT * FROM memory_entries
WHERE tier = 'hot'
  AND supersedes IS NULL          -- "current" (head) — see note below
  AND promoted_at IS NOT NULL
  AND forgotten_at IS NULL
  AND decayed_at IS NULL
  AND expired_at IS NULL;

-- audit (any tier): full chain
SELECT * FROM memory_entries WHERE content_key = $key ORDER BY created_at ASC;
```

**Note on "current" query shape:** the exact head query (supersedes-chain) from Day 04 is the authority; if `supersedes IS NULL` is not exactly "head" (because `supersedes` points at the *predecessor*), use the Day 04 `findHead` logic. Do not invent a second "current" definition today.

---

## 3. Tasks

### 3.1 Migration: `tier`, `archived_at`, `expired_at` (30 min)

- [ ] Add `tier` (default `'hot'`, CHECK constraint), `archived_at`, `expired_at` to `memory_entries`; generate + migrate.
- [ ] Index `tier` (retrieval filters on it).

### 3.2 `RetentionJob` (90 min)

- [ ] `packages/memory/src/retention.ts` — `archive()`, `expire()`, `run()` (§2.3).
- [ ] Publish `memory.entries_archived { ids }` and `memory.entries_expired { ids }` (batch events).

### 3.3 Retrieval hot/cold filter (30 min)

- [ ] `retrieve()` adds `tier = 'hot'` and `expired_at IS NULL`.
- [ ] Add `MemoryStore.listTier(tier)` and `MemoryStore.getChain(contentKey)` (audit, all tiers) for the debug API + tests.

### 3.4 Tests (120 min)

- [ ] Entry unused 90+ days → archived (`tier='cold'`) and excluded from `retrieve()`.
- [ ] Entry past `expires_at` → expired and excluded; explicitly restorable via `unforget`.
- [ ] `retrieve()` returns zero cold entries.
- [ ] `getChain()` returns cold + hot versions for a content key.
- [ ] `RetentionReport` counts and byte estimates are non-negative and self-consistent.

### 3.5 Debug API + report log (60 min)

- [ ] Extend `apps/api/src/routes/debug.ts`: `GET /debug/memory?tier=cold` and `GET /debug/memory/:contentKey/chain`.
- [ ] Have `RetentionJob.run()` log the report at run end (observability).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/memory/src/retention.ts` | `RetentionJob` (archive + expire) |
| `packages/db/src/schema/memory.ts` + migration | `tier`, `archived_at`, `expired_at` |
| `packages/memory/src/memory-store.ts` (updated) | hot-only retrieval; audit chain query |
| `apps/api/src/routes/debug.ts` (updated) | tier + chain debug endpoints |
| `packages/memory/src/__tests__/retention.test.ts` | Archive/expire/tier tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/memory test` — all tests pass.
- [ ] `retrieve()` returns hot entries only (cold + expired excluded). Prove with a mixed-tier fixture.
- [ ] Entry unused ≥ 90 days has `tier='cold'` after the sweep.
- [ ] Entry past `expires_at` has `expired_at` set and is excluded; restorable via `unforget`.
- [ ] No delete statements anywhere in `packages/memory` (archive/expire are tombstones/tier flips).
- [ ] Audit `getChain()` returns the full version chain regardless of tier.
- [ ] `RetentionJob` emits batch `memory.entries_archived`/`memory.entries_expired` events.
- [ ] `psql \d memory_entries` shows the `tier` CHECK constraint.

---

## 6. Notes & Pitfalls

- **Archive frees *ranking budget*, not disk.** The benefit is that `retrieve()` scans fewer candidates, not storage savings. If you implement archive as a physical move to S3 and skip the query-side savings, you've done the wrong half. Logical tiering first.
- **Do not archive the current head of a chain while predecessors stay hot.** If `v3` is "current" but `v2` (superseded) has recent `last_retrieved_at`, naively archiving `v3` for 90-day inactivity and leaving `v2` hot resurrects stale info. Archive/de-archive moves *entire chains* by `content_key`, not individual rows.
- **Expiration ≠ decay ≠ archive.** Three distinct tombstones (`expired_at`, `decayed_at`, `forgotten_at`) plus `tier`. Keep their semantics separate in code and docs; a single "hidden" boolean would collapse three recoverable states into one irreversible one.
- **90 days is a constant to expose.** Tie it to the same named config as the decay floor. Week 6 benchmark and Week 8 hardening may tune it against real traffic.
- **Evidence rows are not archived today.** Memory archival is separate from evidence cold-storage (Spec 9 §5). Do not sweep the evidence tables — that's a Phase-3-later concern and tampering with immutable evidence is forbidden.
- **Tomorrow (Day 08):** Trajectory Fork — head-to-head model/prompt/context comparison (Spec 3 §6.1).

---

*Prev: [Day 6 — Consolidation: Dedup (0.85), Conflict Strategy, Decay (0.99^days)](day-06.md) | Next: [Day 8 — Trajectory Fork: Head-to-head Model/Prompt/Context Comparison](day-08.md)*
