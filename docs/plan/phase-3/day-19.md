# Day 19 — Integrate Hybrid Default: rank_method Cutover + A/B vs Shadow Baseline

| | |
|---|---|
| **Week** | 4 — Hybrid context default |
| **Spec refs** | Spec 4 §5.1 (hybrid default, RR F + re-rank), Spec 11 §5 (A/B harness: beat the incumbent before rollout) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 18 (RAG Fusion behind the seam) |

---

## 1. Objectives

By end of day you will have:

1. The **hybrid (BM25 + embeddings + RRF + re-rank) as the default `Retriever`**, via the `rank_method` column cutover — *after* the A/B proves it wins, not before.
2. An **A/B comparison** against the Phase-2 shadow baseline (`keyword` ranker) on a held-out set of historical tasks, driven by the existing A/B harness (Spec 11 §5).
3. A **rollout gate**: hybrid becomes default only if it beats the incumbent on a predefined metric (Spec 11 §5 "beat the incumbent" gate).
4. A **cutover record** (`rank_method` flip + timestamp + winning metric) so the switch is auditable and reversible.

This is where the week's invariant is *proven*: hybrid earns default by winning the A/B, not by being newer.

---

## 2. Design Decisions

### 2.1 The cutover is a measured, reversible config flip

`rank_method` is already a column (Phase 2 kept `keyword` as default). The cutover:

```sql
-- after the A/B gate passes:
UPDATE projects SET context_rank_method = 'hybrid' WHERE ...;
-- or flip the default + record the change in an audit row
INSERT INTO metric_gates (gate, incumbent, challenger, winner, metric_value, decided_at)
VALUES ('context_rank_default', 'keyword', 'hybrid', 'hybrid', 0.18, now());
```

- **Default changes only after the gate passes.** The shadow baseline (`keyword`) stays live until then.
- The flip is a **named, logged migration-like step**, not an implicit code change. Reversibility = set `rank_method` back + the audit row records both directions.

### 2.2 The A/B harness is reused, not rebuilt

Phase 2 built a shadow A/B harness (Spec 11 §5: replay historical tasks through two pipeline configs). Day 19 *uses* it:

```typescript
interface RankAbResult {
  incumbent: 'keyword';
  challenger: 'hybrid';
  metric: 'top1_target_file_hit_rate' | 'routing_precision' | 'context_sufficiency';
  incumbentScore: number;
  challengerScore: number;
  winner: 'incumbent' | 'challenger' | 'draw';
}
```

- Replay an identical held-out task set through both rankers; compare the *predefined* metric.
- Do **not** invent a new metric today; use the metric Spec 11 §5.1 already names (e.g. "does re-ranking put the file that actually fixed the bug in the top-N" — `top-K target-file hit rate`).

### 2.3 Winner rules

- Hybrid becomes default **only if** `challengerScore > incumbentScore` on the predefined metric (no "newer wins" tie-break).
- A **draw or loss** keeps `keyword` default; hybrid stays shadow and the result is written to the gate log for a later Day 32 re-fit.
- The gate result is recorded (table above) so Day 39 regression can re-verify "hybrid still beats keyword."

### 2.4 Shadow-during-cutover safety

For a short window (Day 19–20), run hybrid as default while the *previous* keyword ranker still computes in shadow, so a regression can be caught and reverted immediately. Store both rankings in snapshot metadata (`shadow_keyword_order`) for the Day 20 freshness/lost-in-middle check.

### 2.5 Freshness interaction (surfaced for Day 20)

The cutover must re-verify Spec 4 §8 freshness + §5.2.4 validation on the hybrid path: target-file presence, token budget, STALE handling all still apply. Note any place where the hybrid retriever returns a source the keyword ranker would have pruned (or vice-versa) for Day 20's explicit test.

---

## 3. Tasks

### 3.1 A/B run on held-out tasks (120 min)

- [ ] Assemble the held-out task set (reuse Phase 2 replay fixtures; ≥ 15 tasks including REWORK + defect-caught-later cases).
- [ ] Run incumbent (`keyword`) vs challenger (`hybrid`) via the A/B harness; record `RankAbResult`.

### 3.2 Implement the rollout gate (90 min)

- [ ] `evaluateRankCutover()` implements §2.3 winner rules; writes `metric_gates` row.
- [ ] Gate result drives whether the default flips (no manual "just flip it").

### 3.3 Cutover + shadow window (90 min)

- [ ] If (and only if) gate passes: flip `rank_method` default to `hybrid`; keep `keyword` shadow recorded in snapshot metadata (§2.4).
- [ ] Audit row + `rank.cutover_applied` event.

### 3.4 Reversibility drill (45 min)

- [ ] Script the rollback: set `rank_method` back; assert snapshots revert to keyword ordering. Run it once in a test DB to prove the path exists.

### 3.5 Tests (120 min)

- [ ] Gate logic: challenger better → winner challenger; draw/loss → incumbent stays.
- [ ] Cutover row + event written with metric values.
- [ ] Shadow rankings present in snapshot metadata during the window.
- [ ] Rollback restores `keyword` default (reversibility).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/rank/gate.ts` | `evaluateRankCutover`, `metric_gates` write |
| `packages/db/src/schema/gates.ts` + migration | `metric_gates` table |
| `scripts/ab-rank-cutover.ts` | A/B + cutover orchestration script |
| `packages/context-engine/src/__tests__/cutover.test.ts` | Gate/revert tests |
| `docs/architecture/wiring-map.md` (updated) | Default ranker + gate |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/context-engine test` — all tests pass.
- [ ] A/B result recorded with a predefined metric (top-K target-file hit rate) for incumbent vs challenger.
- [ ] Hybrid becomes default **only if** the gate passes (challenger > incumbent); draw/loss keeps keyword.
- [ ] `metric_gates` row records winner + metric value + timestamp (auditable).
- [ ] Shadow keyword ranking is retained in snapshot metadata during the cutover window.
- [ ] Rollback drill proven: set `rank_method` back → ordering reverts.
- [ ] `rank.cutover_applied` event emitted if (and only if) the flip happened.
- [ ] `pnpm lint` clean.

---

## 6. Notes & Pitfalls

- **The gate, not the engineer, flips the default.** If you manually set `hybrid` because "it obviously works," you've violated the one invariant that makes this phase trustworthy. The A/B result is the only authorized trigger.
- **Predefine the metric before running.** Spec 11 §5.1: a new capability must beat the incumbent on a predefined metric. Choosing the metric *after* seeing results is the optimizer's self-deception. Write it down in the gate row *before* the score.
- **A loss is a finding, not a failure.** If hybrid loses, that's valuable: record it, keep shadow, and let Day 32's ranking-parameter learning address it. A forced cutover hides a real quality gap.
- **The shadow window is temporary.** It costs double ranking compute. Close it on Day 20 once freshness/lost-in-middle checks pass; do not leave a permanent double-rank in the hot path.
- **Reversibility is not theoretical.** The rollback drill is a Day-19 acceptance criterion, not a note. A default you can't revert is a default you can't ship.
- **Tomorrow (Day 20):** Week 4 checkpoint — lost-in-middle + freshness under hybrid; shadow→default cutover clean.

---

*Prev: [Day 18 — RAG Fusion: Multi-query + Reciprocal Ranking behind Retriever](day-18.md) | Next: [Day 20 — Week 4 Checkpoint: Lost-in-middle + Freshness Under Hybrid; Clean Cutover](day-20.md)*
