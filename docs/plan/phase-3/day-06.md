# Day 06 — Consolidation: Dedup (0.85), Conflict Strategy, Decay (0.99^days)

| | |
|---|---|
| **Week** | 2 — Memory lifecycle + trajectory |
| **Spec refs** | Spec 9 §4.5 (consolidation pipeline: dedup/conflict/decay/archive, decay formula) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 05 (Week 1 checkpoint — memory write+read demonstrable) |

---

## 1. Objectives

By end of day you will have:

1. A **consolidation pipeline** that runs offline (not the hot path) with four stages: dedup, conflict, decay, archive (archive deferred to Day 07).
2. **Dedup** — merge entries whose similarity exceeds `0.85`, unioning their `sourceEvidence` (Spec 9 §4.5).
3. **Conflict** — when two entries contradict, keep the higher-`confidence` **and** more-recent-evidence one; the loser is superseded, never deleted.
4. **Decay** — effective weight `0.99^days_since_last_use`; decayed entries stop being offered as a Context rank signal.

This is the managed-lifecycle half of Spec 9 §4.5: memory is a *managed store*, not a grow-forever pile.

---

## 2. Design Decisions

### 2.1 Offline job, not a query-time side effect

Consolidation is a periodic job (`ConsolidationJob`), triggered by a scheduler or manual run — **never** on the `retrieve()` path. Rationale: dedup/conflict are O(n²)-ish over the corpus, and doing them inline would add latency to context resolution (Spec 4 §5's p95 concerns).

```typescript
// packages/memory/src/consolidation.ts
export class ConsolidationJob {
  constructor(
    private readonly store: MemoryStore,
    private readonly similarity: SimilarityProvider,
    private readonly bus: IEventBus,
  ) {}

  async run(opts: { batchSize?: number } = {}): Promise<ConsolidationReport> {
    // 1. dedup()  2. conflict()  3. decay()  — in this order (see §2.5)
    // returns counts: merged, superseded, decayed
  }
}
```

### 2.2 Dedup (threshold 0.85)

For each kind, cluster entries by pairwise `similarity(content_i, content_j) ≥ 0.85`:

- Merge each cluster into one entry whose `content` is the *longest / most-cited* member (not an average), whose `confidence` is `max(confidence)`, and whose `sourceEvidence` is the **union** of all members.
- The merged entry is written as a **new version** (`supersedes` the head members) — consistent with Day 04's append-only rule.
- Publish `memory.entry_consolidated { mergedEntryId, supersededIds }`.

**Why union the evidence, not pick one?** Spec 9 §4.5 is explicit: "one entry whose `sourceEvidence` is the union of both." Losing evidence links on merge breaks the ≥1-link invariant's traceability.

### 2.3 Conflict strategy (contradiction resolution)

Contradiction is detected when two entries are *similar* (≥ 0.85) but express opposite content (e.g. "use X" vs "avoid X"), or carry a `contradicts` flag set by a prior judge/distiller.

Resolution: keep the entry with **higher `confidence` and more recent evidence** (both criteria, in that order); supersede the loser with a `metadata.conflict = { supersededBy, reason }`. The loser is never deleted (§4.4).

```typescript
function resolveConflict(a: MemoryEntry, b: MemoryEntry): MemoryEntry {
  // tie-break: confidence desc, then evidence recency desc, then id asc (deterministic)
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  const aRecency = maxEvidenceRecency(a.sourceEvidence);
  const bRecency = maxEvidenceRecency(b.sourceEvidence);
  if (aRecency !== bRecency) return aRecency > bRecency ? a : b;
  return a.id < b.id ? a : b;
}
```

### 2.4 Decay (0.99^days since last use)

Effective weight `w_eff = 0.99 ^ days_since_last_use`, where `days_since_last_use` is computed from `last_retrieved_at` (fallback `created_at`). Effects:

- Add a `decayed_at timestamptz NULL` column (migration).
- When `w_eff` falls below a configured floor (start `0.50`, ~69 days), set `decayed_at = now()` and **stop offering as a rank signal** (retrieval filter, same as `promoted_at`/`forgotten_at`).
- Decay is **reversible**: a subsequent retrieve resets `last_retrieved_at` and clears `decayed_at` (un-decay). The entry was never deleted.

```sql
-- daily sweep:
UPDATE memory_entries
SET decayed_at = now()
WHERE decayed_at IS NULL
  AND promoted_at IS NOT NULL
  AND 0.99 ^ (EXTRACT(EPOCH FROM (now() - COALESCE(last_retrieved_at, created_at))) / 86400.0) < $floor;
```

### 2.5 Ordering matters (decay-vs-dedup is the classic trap)

Run **dedup and conflict before decay**. If decay runs first, freshly-stale entries get dropped from the candidate set and never merge with a near-duplicate that is still alive — leaving duplicate memories that decay would otherwise have folded together. Document this ordering as an invariant in the job header.

---

## 3. Tasks

### 3.1 Migration: `decayed_at` (+ conflict metadata) (30 min)

- [ ] Add `decayed_at timestamptz NULL` to `memory_entries`; generate + migrate.
- [ ] Add `metadata jsonb` (nullable) for `conflict`/`consolidated` annotations if not already present.

### 3.2 `ConsolidationJob.dedup` (90 min)

- [ ] Cluster within each kind using `SimilarityProvider` at threshold 0.85.
- [ ] Merge → new version with unioned evidence + `supersedes` heads; publish `memory.entry_consolidated`.
- [ ] Tests: two 0.9-similar DECISION entries merge; union evidence contains both links; two 0.5 entries do NOT merge.

### 3.3 `ConsolidationJob.resolveConflicts` (75 min)

- [ ] Detect + resolve contradictory pairs (§2.3); supersede loser; write `metadata.conflict`.
- [ ] Tests: higher-confidence wins; equal confidence → more-recent evidence wins; deterministic tie-break.

### 3.4 `ConsolidationJob.decay` (60 min)

- [ ] Compute `w_eff = 0.99^days` from `COALESCE(last_retrieved_at, created_at)`; mark `decayed_at` below floor.
- [ ] Un-decay on retrieval (clear `decayed_at` when served).
- [ ] Tests: entry unused 100 days decays (weight < 0.50); entry used 1 day ago does not; retrieval clears `decayed_at`.

### 3.5 Retrieval filter update (45 min)

- [ ] `retrieve()` excludes `decayed_at IS NOT NULL` heads (alongside promotion/tombstone filters).
- [ ] Update Day 03/04 tests to seed non-decayed entries.

### 3.6 Ordering test + report (60 min)

- [ ] Integration test: seed a near-duplicate pair AND an old unused entry; run `run()`; assert dedup produced a merged head AND decay marked the stale entry; assert a dedup-then-decay ordering via the report counts.
- [ ] `ConsolidationReport` returned with `{ merged, superseded, decayed }` counts; log it.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/memory/src/consolidation.ts` | `ConsolidationJob` (dedup/conflict/decay) |
| `packages/memory/src/similarity.ts` (reused) | Pairwise similarity provider |
| `packages/db/src/schema/memory.ts` + migration | `decayed_at`, `metadata` |
| `packages/memory/src/__tests__/consolidation.test.ts` | Dedup/conflict/decay/ordering tests |
| `packages/memory/src/memory-store.ts` (updated) | Retrieval decay filter; un-decay |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/memory test` — all tests pass.
- [ ] Dedup merges at similarity ≥ 0.85, does not merge below 0.85, and unions `sourceEvidence`.
- [ ] Conflict keeps higher-confidence + more-recent-evidence entry; loser superseded not deleted.
- [ ] `w_eff = 0.99 ^ days_since_last_use` computed exactly; entry unused 100 days is marked `decayed_at`.
- [ ] `retrieve()` never returns a `decayed_at IS NOT NULL` entry.
- [ ] A retrieval clears `decayed_at` (un-decay).
- [ ] Consolidation runs **offline** — no consolidation logic on the `retrieve()` hot path (prove by code search).
- [ ] Dedup+conflict execute **before** decay (job header documents and a test asserts the ordering).
- [ ] `memory.entry_consolidated` event published with sorted `supersededIds`.

---

## 6. Notes & Pitfalls

- **Decay-vs-dedup ordering is the trap.** Run decay last. If you run decay first, the stale near-duplicate you wanted to fold is gone before dedup sees it — the exact bug this day exists to prevent.
- **Dedup threshold 0.85 is directional, not sacred.** Keep it a named constant; the benchmark (Week 6) and calibration (Day 31) may move it. Do not inline `0.85` in three files.
- **Similarity provider consistency.** Dedup uses the same `SimilarityProvider` as retrieval. If they diverge, "similar enough to merge" and "similar enough to rank together" disagree and memory becomes incoherent. Inject the one instance.
- **Conflict detection needs a contradiction signal.** Pure similarity cannot tell "complementary" from "contradictory." Flag contradictions via distiller/judge metadata, not a threshold guess. Where no signal exists, do **not** auto-merge two similar entries — prefer to keep both and let decay arbitrate.
- **Decay floor vs archive threshold.** `0.50` (decay from ranking) is *not* the same as the 90-day archive cutoff (Day 07). Decay hides from ranking; archive moves to cold storage. Don't conflate them.
- **Un-decay is by design.** Memory that is pulled again comes back. That's the point of `0.99^days`: inactivity *reduces* weight, it doesn't convict forever.
- **Tomorrow (Day 07):** archive (90d) + expiration; hot/cold tiering.

---

*Prev: [Day 5 — Week 1 Checkpoint: Memory Write + Read Demonstrable](day-05.md) | Next: [Day 7 — Archive (90d) + Expiration; Hot/Cold Tier](day-07.md)*
