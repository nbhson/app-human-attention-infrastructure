# Day 32 — Feedback Into Context Ranking: Learn Ranking Parameters From Usefulness

| | |
|---|---|
| **Week** | 7 — Close the loop, deploy observed |
| **Spec refs** | Spec 4 §5.1 (relevance weighting), §5.2.5 (re-rank signals incl. usage/usefulness), Spec 6 §4.1 (feedback loop) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 31 (learning pipeline — evaluation → calibration update) |

---

## 1. Objectives

By end of day you will have:

1. The **usefulness feedback signal** (`was_useful`) connected to the context-ranking parameter surface: the relevance score's recency/access-frequency weights become *learnable* from real usefulness.
2. A **ranking-parameter calibration target** (`ranking_weights`) in the learning pipeline: `prepareUpdate('ranking_weights', …)` produces a diff against the current `0.6/0.2/0.2` (similarity/recency/access-frequency).
3. The invariant enforced end-to-end: **hybrid ranking earns default by winning the A/B, not by being newer** — learned weights go through shadow/A/B first, never a silent default switch.

This is where the closed loop meets the single most user-visible subsystem (context relevance), so it is the highest-risk calibration target in the whole phase.

---

## 2. Design Decisions

### 2.1 Usefulness is the ground truth here

The ranking-parameter learner optimizes for **usefulness** — the human's `was_useful` signal (Spec 6 §4.1), captured in Phase 1/2 and now aggregated per retrieved-item and per ranking configuration. "Useful" is a human determination; the learner just fits parameters to it.

### 2.2 The parameter surface (explicit, bounded)

```typescript
// context-engine relevance weights (Spec 4 §5.1) exposed as a config object, not magic constants
export interface RankingWeights {
  similarity: number;   // lexical+semantic combined similarity (default 0.6)
  recency: number;      // default 0.2
  accessFrequency: number; // default 0.2
}                         // invariant: sum == 1.0
```

The learner is constrained: weights ∈ [0,1], sum to 1.0, and each bounded away from 0 (a zero weight silently drops a signal — no "learned" disabling of a safety-relevant dimension without review).

### 2.3 `was_useful` aggregation → feature/label pairs

- **Feature**: per retrieved item (or per query) the current `similarity`/`recency`/`accessFrequency` component values.
- **Label**: the downstream `was_useful` (binary) aggregated over the item's retrieval window.

The learner fits a small logistic/weighted model over these pairs. Sample size gates from Day 31 apply; a weighting change needs a usefulness lift with `effectSize`/`pValue`, not a hunch.

### 2.4 Integration with `rank_method` (shadow-then-default)

The learned weights are a **ranking parameter**, not a rank-method switch. They ride the exact seam Day 17–19 built:
- New weights enter as a **shadow** ranking config on the same A/B harness.
- They become default only by **winning the A/B** on usefulness (the Day 19 `metric_gates` gate), recorded via `rank.cutover_applied`.
- The invariant from Architecture §24/README holds: *hybrid ranking earns default by winning the A/B, not by being newer.* Learned weights are no exception.

### 2.5 Boundary + no self-reinforcement without gate

`@harness/learning` produces the `ranking_weights` `CalibrationUpdate`; `@harness/context-engine` consumes the *approved* weights only through config/DI. There is no path where the learner writes directly into the live context-engine state. If usefulness dips post-application, the A/B can roll back to the prior config.

---

## 3. Tasks

### 3.1 `was_useful` aggregation (120 min)

- [ ] `usefulness.ts` — aggregate `was_useful` per retrieved item/query into feature/label rows (reuse Phase 1/2 events; dedup).
- [ ] Expose as a `evaluation_results` source (Day 31 ingestor) so it flows through the same pipeline.

### 3.2 Ranking-weights target + search (150 min)

- [ ] `prepareUpdate('ranking_weights', evidence)` — bounded search over `{similarity,recency,accessFrequency}`, sum-to-1 constraint, MIN bound per dimension (§2.2–2.3).
- [ ] Compute `effectSize`/`pValue` on usefulness (frozen corpus usefulness slice + production signal).

### 3.3 A/B + shadow wiring (150 min)

- [ ] New weights → shadow ranking config on the Day 19 A/B harness (reuse `rank_method` seam + `metric_gates`).
- [ ] `rank.cutover_applied` only on usefulness win; rollback path preserved.

### 3.4 Tests (120 min)

- [ ] Weight sum-to-1 enforced; zeroing a dimension rejected.
- [ ] Insufficient-sample update → `REJECTED` (no tuning on noise).
- [ ] Learned weights never bypass the A/B (no direct live-state write); default changes only via winning A/B.
- [ ] Rollback to prior weights on usefulness dip.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/learning/src/usefulness.ts` | `was_useful` aggregation → feature/label pairs |
| `packages/learning/src/updater.ts` (updated) | `ranking_weights` target + bounded search |
| `packages/context-engine/src/ranking-config.ts` | `RankingWeights` exposed as config |
| `apps/api/src/...` (A/B adapter, updated) | Shadow ranking config + `rank.cutover_applied` |
| `packages/learning/src/__tests__/ranking.updater.test.ts` | Weight/AB/rollback tests |

---

## 5. Acceptance Criteria

- [ ] `was_useful` aggregated into feature/label pairs and ingested through the learning pipeline (dedup).
- [ ] `ranking_weights` updates are bounded (sum-to-1, per-dimension floor) and statistically gated (`effectSize`/`pValue`/`MIN_SAMPLES`).
- [ ] Zeroing a similarity/recency/access-frequency dimension is rejected (no learned disabling of a signal).
- [ ] Learned weights enter as a shadow config; default changes **only** by winning the A/B on usefulness (`rank.cutover_applied`).
- [ ] The learner has no direct write into live context-engine state; rollback to prior weights works.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **Usefulness is a human signal; the learner only fits to it.** If the "ground truth" is the judge (Day 28) rather than `was_useful`, you've closed a loop on the judge's bias. Ground ranking learning in the human's usefulness determination.
- **The invariant is load-bearing here.** "Hybrid ranking earns default by winning the A/B, not by being newer" — learned weights are the single most tempting place to skip that and "just set it." A learned weight that bypasses the A/B is the invariant broken where it matters most.
- **A zero weight is a silent feature kill.** Bound every dimension away from 0. "Learning" that recency isn't useful this month must not invisibly delete recency from scoring; that's a reviewable change, not a fitted constant.
- **Ranking is user-visible; rollback matters.** Unlike a memory-retention knob, a bad ranking change is felt immediately by users. Keep the prior config one A/B toggle away.
- **Reuse the Day 19 A/B, don't re-invent it.** The `rank_method` seam, `metric_gates`, and `rank.cutover_applied` already encode exactly this governance. Build on them.
- **Tomorrow (Day 33):** closed-loop wiring — Evaluate → Calibrate → Deploy → Observe runs continuously.

---

*Prev: [Day 31 — Learning Pipeline: Evaluation Results → Calibration Update (Automated)](day-31.md) | Next: [Day 33 — Closed-Loop Wiring: Evaluate → Calibrate → Deploy → Observe Runs Continuously](day-33.md)*
