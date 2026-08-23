# Day 08 — Review Replay Engine: Replay a Recorded Review (Spec 11 §5)

| | |
|---|---|
| **Week** | W2 — Evaluation v0 + Spec 10 |
| **Spec refs** | Spec 11 §5 (A/B substrate / replay), Spec 9 §3 (review record as evidence), Spec 4 §2.2 (`ContextSnapshot`) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 07 (report store); the recorded-review surface — `review_reports`, `review_decisions`, `context_snapshots` — persisted from Phase-1 runs |

---

## 1. Objectives

By end of day you will have:

1. A **`ReviewReplayer`** in `@harness/evaluation` that re-materializes a recorded **review** — the report, the `ContextSnapshot` the reviewer saw, the decision, and the outcome — deterministically and offline. No live LLM, no re-fetching, no external tool calls.
2. **Replay validation** — the replay must reproduce each component exactly (report hash, snapshot id, decision fields); a mismatch is a hard error, because a replay that silently diverges is worse than no replay.
3. A **`ReviewReplay`** artifact summarizing deltas: components replayed, matched, and any divergence from the original.
4. A **CLI + tests** proving bidirectional fidelity: `replay(reviewId)` reproduces the stored review, and a tampered record is *detected*, not replayed.

This is the first half of Spec 11's A/B harness. A/B (Day 09) re-runs the *routing/ranking* over the same replayed review through two variants; today you build the engine that replays it through **one** — the determinism guarantee without which every comparison would be noise.

---

## 2. Design Decisions

### 2.1 What a "recorded review" is — report + context + decision, not a trajectory

```typescript
// packages/evaluation/src/replay/review-replay.ts
export interface RecordedReview {
  reviewId: string;
  taskId: string;
  report: ReviewReport;              // findings + fix suggestions text (content-addressed)
  contextSnapshotId: string;         // the ContextSnapshot the reviewer was shown
  decision: { verdict: string; actorId: string | null; wasUseful: boolean | null };
  evidenceRefs: string[];            // verification results linked to the review
  outcome: 'APPROVED' | 'REJECTED' | 'REWORKED' | 'DEFECTED_LATER';
  contentHash: string;               // SHA-256 over the ordered record
}
```

The replayer reads from the live review tables (`review_reports`, `review_decisions`, `context_snapshots`) — **not** any code-generation trajectory table. The unit of replay is *"what the reviewer saw and decided"*, which is exactly what Day 09's routing-variant comparison needs as a contested, re-runnable input.

### 2.2 Replay is read-only, deterministic, and evidence-backed

```typescript
// packages/evaluation/src/replay/review-replayer.ts
export interface ReviewReplay {
  reviewId: string;
  components: { report: boolean; context: boolean; decision: boolean };
  matched: boolean;                 // all components reproduced exactly?
  divergence?: string;              // first mismatch detail, if any
  sourceHash: string;
}
```

The replayer loads the record, verifies `contentHash` (§2.3), then reproduces each component by *reference* — it re-resolves the stored `contextSnapshotId` and the stored report/decision rows, asserting byte/key equality. No component is regenerated.

### 2.3 Integrity — hash before replay

Before re-materializing, compute the hash over the ordered record and compare to the stored `contentHash` (Spec 9 §3.2's `immutableHash` rule). A mismatch aborts: you replay what was recorded, or you don't replay at all.

### 2.4 The replay holds the original `ContextSnapshot` — it does not re-collect

The replayer does **not** re-run context collection; it holds the original `ContextSnapshot`. This keeps today bounded. Day 09's A/B harness is where two variants *re-resolve* context and compare — today just proves a faithful single-path replay of the review.

---

## 3. Tasks

### 3.1 Replay types + loader (60 min)
- [ ] `packages/evaluation/src/replay/review-replay.ts` — `RecordedReview`/`ReviewReplay` (§2.1).
- [ ] `packages/evaluation/src/replay/loader.ts` — load a `RecordedReview` by `reviewId` (join `review_reports` × `review_decisions` × `context_snapshots`), verify `contentHash` (§2.3).

### 3.2 `ReviewReplayer` (150 min)
- [ ] `packages/evaluation/src/review-replayer.ts` — implement §2.2: resolve each component by reference; `matched` only if report hash, snapshot id, and decision fields all equal the record; any gap → `ReplayDivergenceError`.
- [ ] `packages/evaluation/src/replay/errors.ts` — `ReplayDivergenceError`, `ReviewHashMismatchError`.

### 3.3 CLI + fixture (90 min)
- [ ] `cli.ts` adds `pnpm eval:replay --review-id …`; prints `ReviewReplay`.
- [ ] Add a **fixture review** (`fixtures/reviews/recorded-review.json`) — a realistic stored review (report + snapshot + decision + evidence) captured from the Phase-1 pipeline.

### 3.4 Fidelity tests (120 min)
- [ ] Forward: `replay(fixture)` → `matched === true` across all three components.
- [ ] Round-trip: replay twice → byte-identical `ReviewReplay`.
- [ ] Divergence: mutate a report byte, a snapshot id, or a decision field → each throws.
- [ ] No live call: loader + replayer perform zero LLM/fetch calls (counting proxy asserts 0).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/evaluation/src/replay/{review-replay,loader}.ts` | Replay substrate |
| `packages/evaluation/src/review-replayer.ts` | The replayer |
| `packages/evaluation/src/replay/errors.ts` | Divergence / hash errors |
| `fixtures/reviews/recorded-review.json` | Recorded review fixture |
| `packages/evaluation/src/__tests__/review-replayer.test.ts` | Fidelity tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm eval:replay --review-id <fixture>` replays every component with `matched === true`.
- [ ] The replayer performs **zero** live LLM/fetch calls during the replay test.
- [ ] Mutating a report byte, a snapshot id, or a decision field throws `ReplayDivergenceError` (three failures).
- [ ] A record whose `contentHash` mismatches throws `ReviewHashMismatchError` before any component is replayed.
- [ ] Two consecutive replays produce byte-identical `ReviewReplay` output.
- [ ] The loader reads only `review_reports` / `review_decisions` / `context_snapshots` — `grep -rn "agent_runs\|trajectory" packages/evaluation/src/replay` returns zero.
- [ ] `pnpm --filter @harness/evaluation test` green.

---

## 6. Notes & Pitfalls

- **A replayer that doesn't verify `matched` is a record reader, not a replay engine.** The point is the *guarantee* that the replayed snapshot/decision is the one recorded. Tolerating divergence as a warning makes Day 09's A/B comparison attribute replay drift to a routing variant — catastrophic for calibration.
- **Never re-collect context today.** Re-collecting re-introduces the nondeterminism (files moved, index changed) that replay exists to eliminate. Day 09 chooses where the *variant* boundary sits.
- **Hash before you loop.** A tampering check that runs *after* re-materialization may have already executed a divergent stream. Verify first.
- **The unit of replay is the review, not the agent's execution.** The scope is "what the reviewer saw and decided." Do not reconstruct calls or steps — there are none to reconstruct for a read-only reviewer, and the code-generation trajectory tables are orphaned.
- **Replay is idempotent, but don't cache it by id.** Running replay twice is safe (read-only), but don't serve a stale cached replay after the review store is corrected.
- **Next (Day 09):** the A/B shadow harness — two review-routing variants side-by-side over the same replayed review, compared, with zero production effect.

---

*Prev: [Day 07 — Report Generator: Scheduled Metrics & Trends](day-07.md) | Next: [Day 09 — A/B Shadow Harness: Side-by-Side Review-Routing Variants](day-09.md)*