# Day 32 — Feedback into Context Ranking: Learn from Usefulness

| | |
|---|---|
| **Week** | 7 — Close the loop |
| **Spec refs** | Context §5.1–5.2 (ranking); Spec 11 (usefulness → ranking); Phase-3 README §1 (goal 7) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 31 (learning job); Day 27 (re-rank signals) live |

---

## 1. Objectives

By end of day you will have:

1. A feedback signal flowing **from usefulness into context ranking**: when a human marks a review useful (or a retrieved source proved useful), the **usage/recency features** in the Day-27 re-ranker learn from it.
2. A `usefulness -> ranking` weight/feature update path — the re-rank coefficient for `usage` (and optionally `dependencyProximity`) is updated from observed outcomes, behind the same measured gate.
3. Closed-loop evidence: a useful-marked review bumps the sources it relied on in future ranking; a useless one demotes.
4. The candidate re-ranker runs through the A/B harness before any default change.

This is the *context-engine half* of the closed loop: retrieval ranking now learns from human outcomes.

---

## 2. Design Decisions

### 2.1 Usefulness is a per-source outcome, not just per-review

The loop needs *which sources* earned the "useful" mark — record, per served context snapshot, the source ids that surfaced and whether the review was marked useful. `source_usefulness` rows (snapshot id, source id, useful) become the learning data.

### 2.2 Update features, gate the default

The `usage` weight in the re-ranker is updated from `source_usefulness` (e.g. a recency/usage boost for proven-useful sources, a demote for repeatedly-useless). The updated re-ranker is a *candidate variant* — promotion only through A/B (Day 29 discipline).

### 2.3 Signal, never certainty

A single usefulness mark nudges, doesn't flip. Cap the per-mark influence and decay old feedback (time-windowed) so one reviewer's quirk doesn't rewire ranking.

### 2.4 Read-only contract re: the reviewer still applies

This only reorders *context fed to the reviewer*; it never changes the PR, never writes code, never alters the decision gate.

---

## 3. Tasks

### 3.1 Per-source usefulness capture (90 min)

- [ ] Record served source ids per snapshot; tie `was_useful`/decision to them → `source_usefulness`.

### 3.2 Feature update (90 min)

- [ ] `UsageLearner` updates the re-ranker's usage weight from `source_usefulness` (bounded + decayed).

### 3.3 Candidate + A/B (60 min)

- [ ] Emit updated re-ranker as a variant; wire into the harness.

### 3.4 Wiring into the loop (45 min)

- [ ] Hook `UsageLearner` into the Day-31 calibration job cadence.

### 3.5 Tests (75 min)

- [ ] Useful mark bumps proven-useful sources; useless demotes; per-mark influence capped; candidate runnable by harness; no default flip.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/ranking/usage-learner.ts` | Usefulness → usage feature update |
| `packages/db/src/schema/context.ts` (updated) | `source_usefulness` rows |
| `packages/context-engine/src/__tests__/usage-feedback.test.ts` | Feedback tests |

---

## 5. Acceptance Criteria

- [ ] `source_usefulness` recorded from served snapshots + review outcomes.
- [ ] Usage weight updates from observed usefulness (bounded, decayed).
- [ ] Proven-useful sources rank higher in subsequent retrievals; useless ones lower.
- [ ] Updated re-ranker is a candidate variant; no unmeasured default flip.
- [ ] `pnpm --filter @harness/context-engine test` green.

---

## 6. Notes & Pitfalls

- **Attribute usefulness to sources, not just the review.** A global "useful review" mark can't tell *which* source mattered; capture per-snapshot source ids or the loop has no signal.
- **Bound the influence.** One enthusiastic mark must not lock a source at the top forever — cap + decay, or the ranking ossifies.
- **This reorders context, nothing else.** Keep the AI reviewer read-only; usefulness feedback never reaches a git host or a decision.
- **Day 33:** closed loop wiring — Evaluate → Calibrate → Deploy → Observe.

---

*Next: [Day 33 — Closed Loop Wiring: Evaluate → Calibrate → Deploy → Observe](day-33.md)*