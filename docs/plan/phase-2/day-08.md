# Day 08 — Trajectory Replay Engine (Spec 3 §6.1)

| | |
|---|---|
| **Week** | 2 — Evaluation v0 + Spec 10 |
| **Spec refs** | Spec 3 §6.1 (Replay op — "re-materialize any past run step-by-step"), Spec 9 §3 (trajectory stored as evidence), Spec 11 §5 (A/B substrate) |
| **Estimated effort** | 8 hours |
| **Prerequisites** | Day 07 (report store); Phase-1 `AgentRunTrajectory` with deterministic `steps[]` (tool_input/output/model/prompt_hash) persisted |

---

## 1. Objectives

By end of day you will have:

1. A **`TrajectoryReplayer`** in `@harness/evaluation` that re-materializes a recorded run **step-by-step from the stored `steps[]`** — no live LLM, no external tool calls — reproducing the same sequence the agent executed.
2. **Replay validation** — the replay must reproduce every step's type, tool, and inputs exactly; a mismatched or missing step is a hard error, because a replay that silently diverges is worse than no replay.
3. A **replay artifact** (a `ReplayResult`) that summarizes deltas: steps replayed, tool calls resolved, tokens "would-have-been-spent", and any divergence from the original.
4. A **CLI + tests** proving bidirectional fidelity: `replay(run_id) → steps` equals the original `steps[]` for a fixture run, and a tampered trajectory is *detected*, not replayed.

This is the first half of Spec 11's A/B harness. A/B (Day 09) replays a trajectory through *two pipeline variants*; today you build the engine that replays it through **one** — the determinism guarantee without which every A/B comparison would be noise.

---

## 2. Design Decisions

### 2.1 Replay is read-only, deterministic, and evidence-backed

```typescript
// packages/evaluation/src/trajectory-replayer.ts
export interface ReplayInput {
  runId: RunId;
  trajectory: AgentRunTrajectory;       // loaded from the store
}

export interface ReplayStep {
  index: number;
  type: 'THOUGHT' | 'TOOL_CALL';
  replayed: boolean;
  matched: boolean;                     // did the replayed step equal the original?
  note?: string;                        // divergence detail, if any
}

export interface ReplayResult {
  runId: string;
  steps: ReplayStep[];
  unmatched: number;                    // must be 0 for a valid replay
  resolvedToolCalls: number;
  wouldHaveTokens: number;
  sourceHash: string;                   // hash of the trajectory we replayed
}
```

The replayer reads `steps[]` and feeds them through a **no-op tool executor** (a `StubToolExecutor` that returns the *recorded* `tool_output` for each `tool_input` instead of calling a live tool). This is what "no external calls" means: the recorded output *is* the observation; replaying the observation requires no provider.

### 2.2 Why `matched` is enforced, not advisory

A replayed step must reproduce the original `tool_name + tool_input` (and, for THOUGHT, the content). If re-materialization diverges — a missing step, an out-of-order index, a hash mismatch — set `matched: false` and fail the replay with `ReplayDivergenceError`. Reason: the A/B harness (Day 09) will run the *same replay* through two context-ranking variants; if the replay itself drifts, the harness cannot attribute a difference to the variant.

### 2.3 Trajectory integrity — hash before replay

Spec 3 §6.1 commits trajectories to be append-only event streams. Before replay, compute a hash over `steps[]` and compare to the `trajectory.content_hash` (or a stored `immutableHash` mirroring Spec 9 §3.1). A mismatch aborts — you replay what was recorded, or you don't replay at all.

### 2.4 The replay seam is the same `Retriever`/`Ranker` seam Day 18 extends

For **context** steps inside a trajectory (the agent's context snapshot reference), the replayer does not re-run collection — it holds the original `ContextSnapshot` id. This keeps today bounded: replay *agent behavior*, not context resolution. Day 09's A/B harness is where two variants re-resolve context and compare — today just proves a faithful single-path replay.

---

## 3. Tasks

### 3.1 `StubToolExecutor` (60 min)

- [ ] `packages/evaluation/src/replay/stub-tool-executor.ts` — `execute(toolName, toolInput)` returns the `tool_output` present in the same step (lookup from the trajectory). Never does real I/O.

### 3.2 `TrajectoryReplayer` (150 min)

- [ ] `packages/evaluation/src/trajectory-replayer.ts` — implement §2.1/§2.2:
  - iterate `steps[]` in index order;
  - THOUGHT → matched if content equals original;
  - TOOL_CALL → matched if `tool_name` + `tool_input` equal original and stub returns recorded output;
  - any index gap or duplicate → `ReplayDivergenceError`.
- [ ] `packages/evaluation/src/replay/errors.ts` — `ReplayDivergenceError`, `TrajectoryHashMismatchError`.

### 3.3 Integrity + loader (60 min)

- [ ] `packages/evaluation/src/replay/loader.ts` — load a trajectory by `run_id` (from the evidence/event store), verify the content hash (§2.3).
- [ ] Test: a tampered `steps[]` (one byte changed) is detected, not replayed.

### 3.4 CLI + fixture (90 min)

- [ ] `cli.ts` adds `pnpm eval:replay --run-id …`; prints `ReplayResult`.
- [ ] Add a **fixture trajectory** (`fixtures/trajectories/coding-run.json`) — a realistic recorded run (≥5 steps, ≥2 tool calls) captured from the Phase-1 pipeline.

### 3.5 Fidelity tests (120 min)

- [ ] Forward: replay(fixture) → `unmatched === 0`, `steps.length === original.length`.
- [ ] Round-trip: `replay` twice → identical `ReplayResult` (determinism).
- [ ] Divergence: drop a step, reorder two steps, mutate a `tool_input` → each throws.
- [ ] No live call: stub executor logs zero external I/O during replay (assert with a counting proxy).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/evaluation/src/replay/{stub-tool-executor,loader}.ts` | Replay substrate |
| `packages/evaluation/src/trajectory-replayer.ts` | The replayer |
| `packages/evaluation/src/replay/errors.ts` | Divergence / hash errors |
| `fixtures/trajectories/coding-run.json` | Recorded fixture trajectory |
| `packages/evaluation/src/__tests__/trajectory-replayer.test.ts` | Fidelity tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm eval:replay --run-id <fixture>` replays every step with `unmatched === 0`.
- [ ] The replayer performs **zero** live tool/LLM calls (counting proxy asserts 0 during the replay test).
- [ ] Dropping, reordering, or mutating any step throws `ReplayDivergenceError` (three separate failing tests).
- [ ] A trajectory whose content hash doesn't match its recorded hash throws `TrajectoryHashMismatchError` before any step is replayed.
- [ ] Two consecutive replays produce byte-identical `ReplayResult` output.
- [ ] `wouldHaveTokens` sums the recorded `total_tokens` per replayed step and matches the trajectory's original total (fidelity beyond step text).
- [ ] `grep -r "from '@harness" packages/evaluation/src` — no engine imports beyond the allowed set.
- [ ] `pnpm --filter @harness/evaluation test` green.

---

## 6. Notes & Pitfalls

- **A replay that doesn't verify `matched` is a log-reader, not a replay engine.** The whole point is the *guarantee* that Step 3 in the replay is Step 3 as recorded. If divergence is tolerated as a warning, Day 09's A/B comparison silently attributes replay drift to a ranking variant — catastrophic for the calibration that depends on it.
- **Never replay the context resolution today.** Holding the original `ContextSnapshot` id is deliberate. The moment replay tries to re-collect context, it re-introduces the nondeterminism (files moved, index changed) that replay exists to eliminate. Day 09 chooses where the *variant* boundary sits.
- **Hash before you loop.** A tampering check that runs *after* replay means you may have executed a divergent stream already. Verify `content_hash` first, exactly as Spec 9 §3.2 does for evidence.
- **The stub executor looks up outputs, it doesn't "simulate" tools.** Subtle but important: it returns the *recorded* output keyed on the same `tool_input`, which proves the input→output pairing is intact — not that a fake tool "would have" produced something.
- **Replay is idempotent-but-not-idempotent-ish:** running replay twice is safe (read-only), but each run should be independent — don't cache a replay against the run id and serve stale results when the trajectory store is corrected later.
- **Next (Day 09):** the A/B shadow harness — two pipeline variants side-by-side over the same replay, compared, with zero production effect.

---

*Prev: [Day 7 — Report Generator: Scheduled Metrics & Trends](day-07.md) | Next: [Day 9 — A/B Shadow Harness: Side-by-Side Pipeline Variants](day-09.md)*
