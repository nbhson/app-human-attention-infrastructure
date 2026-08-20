# Day 08 — Trajectory Fork: Head-to-head Model/Prompt/Context Comparison

| | |
|---|---|
| **Week** | 2 — Memory lifecycle + trajectory |
| **Spec refs** | Spec 3 §6.1 (Trajectory Operations — Fork), §6 (trajectory structure, deterministic-by-default) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 07 (archive/expire, hot/cold tier) |

---

## 1. Objectives

By end of day you will have:

1. A **Fork operation** on `AgentRunTrajectory`: branch an existing run at step *k*, re-execute with a different model / prompt / context, and compare outcomes (Spec 3 §6.1).
2. The `forked_from: { runId, stepIndex }` first-class field on the trajectory (not a log note), so fork provenance is queryable.
3. A **comparison report** (model/prompt/context × outcome) that feeds head-to-head agent tuning — the runtime half of the A/B engine Phase 2 built.
4. **Parent-immutability**: forking never mutates the parent run (Spec 3 §6.1 "forking never mutates the parent run").

This upgrades the trajectory from a *recording* to a *replayable input* — the first of the four trajectory operations.

---

## 2. Design Decisions

### 2.1 Reuse the append-only step stream

Fork replays the parent's `steps[0..k]` deterministically (Spec 3 §6.1: store `tool_input` + `tool_output` + `model_used`/`prompt_hash` so replay needs no external calls). Then it *diverges*: from step `k+1` the child runs with a different config and records its own steps.

```typescript
interface AgentRunTrajectory {
  runId: string;
  taskId: string;
  agentType: string;
  modelUsed: string;
  promptHash: string;
  forkedFrom?: { runId: string; stepIndex: number };  // FIRST-CLASS (Spec 3 §6.1)
  steps: Step[];          // Step: { index, type, toolInput, toolOutput, modelUsed, promptHash }
  finalOutput: string;
  artifactsChanged: string[];
}
```

### 2.2 Fork API

```typescript
// packages/agent-runtime/src/trajectory/fork.ts
export interface ForkRequest {
  parentRunId: string;
  forkStepIndex: number;        // 0..parent.steps.length (divergence point)
  overrides: {
    model?: string;
    prompt?: string;            // or prompt template + variables
    context?: string;           // alternative ContextSnapshot content
    temperature?: number;
  };
  taskId: string;
}

export interface ForkResult {
  childRunId: string;
  forkedFrom: { runId: string; stepIndex: number };
  // comparison computed and stored:
  outcomesDiffer: boolean;
  divergence: ForkDivergence;   // first differing step index + tool call + output diff
}

export class TrajectoryForkService {
  constructor(private readonly runtime: IAgentRuntime, private readonly store: TrajectoryStore) {}

  async fork(req: ForkRequest): Promise<ForkResult> {
    // 1. Load parent trajectory; validate forkStepIndex ≤ parent.steps.length
    // 2. Create child run with forkedFrom field persisted immediately (crash leaves a stump, not a ghost)
    // 3. Replay steps[0..forkStepIndex] (append-only, idempotent — reuse parent step records)
    // 4. Execute remaining steps under overrides via IAgentRuntime (same tools, same allowedTools)
    // 5. Persist child trajectory with the shared prefix + divergent suffix
    // 6. Compute divergence + comparison report; publish trajectory.forked event
  }
}
```

### 2.3 Parent immutability enforcement

- Child replay copies parent step records into the child's own storage; it does **not** write back to the parent stream.
- Add a DB constraint/column `is_fork_root boolean` (or `forkedFrom IS NULL` = root) and a read-only path for root runs once forked. Test: fork then assert parent `steps[]` length/bytes unchanged.

### 2.4 Comparison report (what "compare outcomes" means)

The comparison is mechanical — not an LLM opinion:

| Axis | Metric |
|------|--------|
| Outcome | final status (`SUCCESS`/`FAILED`/`PARTIAL`) equal? |
| Divergence point | first step index with a differing tool call/output |
| Cost | tokens used (child vs parent) |
| Artifacts | `artifactsChanged` symmetric difference |

```typescript
interface ForkDivergence {
  firstDivergentStep: number | null;   // null = identical after shared prefix
  differingToolCalls: { stepIndex: number; parent: string; child: string }[];
  tokenDelta: number;                  // child.totalTokens - parent.totalTokens
}
```

### 2.5 Replay determinism

Because every step stores `tool_input` + `tool_output` + `prompt_hash` + `model_used` (Phase 1 committed to this), replay of `steps[0..k]` is a copy, not a re-execution. Forks only *execute* the divergent suffix. No external calls occur for the shared prefix.

---

## 3. Tasks

### 3.1 Trajectory schema for forks (60 min)

- [ ] Add `forked_from_run_id`, `forked_from_step_index` to the trajectory persistence (check the actual Phase 1 table/serialization and extend — likely `agent_runs` + `trajectory_steps`).
- [ ] Ensure `trajectory_steps` has a per-run monotonic `step_index` (idempotent append) — Spec 3 §6.1.
- [ ] Migration recorded in `@harness/db`.

### 3.2 `TrajectoryStore` read (60 min)

- [ ] `getRun(runId)` returns full trajectory (steps ordered by `step_index`).
- [ ] Unit tests: step ordering, `forkedFrom` round-trip.

### 3.3 `TrajectoryForkService` (150 min)

- [ ] Implement `fork()` per §2.2 (reuse MockLLM for divergent suffix in tests).
- [ ] Persist `forkedFrom` before executing divergence (crash-safety).
- [ ] Compute `ForkDivergence` + `ForkResult`.

### 3.4 Parent-immutability test (45 min)

- [ ] Fork; snapshot parent steps; assert parent bytes unchanged.
- [ ] Assert child has `forkedFrom = { runId, stepIndex }`, parent has `forkedFrom = null`.

### 3.5 Comparison report + event (60 min)

- [ ] Publish `trajectory.forked { childRunId, parentRunId, forkStepIndex, outcomesDiffer, firstDivergentStep }`.
- [ ] `getComparison(parentRunId, childRunId)` returns the §2.4 report.

### 3.6 Integration test (90 min)

- [ ] Seed a parent 5-step run; fork at step 2 with a different model; assert child steps 0–2 equal parent steps 0–2, steps 3+ differ (MockLLM returns a marker for the new model); assert token delta computed.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/agent-runtime/src/trajectory/fork.ts` | `TrajectoryForkService`, `ForkRequest`, `ForkResult`, `ForkDivergence` |
| `packages/agent-runtime/src/trajectory/store.ts` (updated) | `getRun`, fork fields |
| `packages/db/src/schema/*.ts` + migration | `forked_from_run_id`, `forked_from_step_index` |
| `packages/agent-runtime/src/__tests__/fork.test.ts` | Fork + immutability + comparison tests |
| `docs/architecture/wiring-map.md` (updated) | `TrajectoryForkService` registration |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/agent-runtime test` — all tests pass.
- [ ] `fork()` produces a child with `forkedFrom = { runId, stepIndex }` persisted.
- [ ] Shared prefix (`steps[0..k]`) is byte-identical to the parent; only the suffix is executed.
- [ ] Parent run is **never** mutated by a fork (immutability test).
- [ ] Forking with `forkStepIndex > parent.steps.length` throws (validation).
- [ ] Comparison report computes `outcomesDiffer` and `firstDivergentStep` correctly on a seeded divergence.
- [ ] `trajectory.forked` event carries provenance fields.
- [ ] `pnpm lint` clean; `grep -r "from '@harness" packages/agent-runtime/src` shows only allowed packages.

---

## 6. Notes & Pitfalls

- **Fork replays, it does not re-run.** If the shared prefix is re-executed (instead of copied from stored `tool_output`), the child is not a *fork* — it's a different run that happens to share inputs, and non-deterministic tools will silently diverge before step `k`. Spec 3 §6.1 made steps deterministic-by-default precisely for this.
- **Persist `forkedFrom` before execution.** A crash mid-fork must leave a child with a `forkedFrom` root, or the audit trail shows a run with no origin. Write the stump first.
- **Whole-chain fork grouping.** Retrieval/"which runs fork from X" queries depend on `forked_from_run_id` being indexed. Add the index now or the comparison later does a table scan.
- **MockLLM for divergence.** The divergent suffix in tests uses MockLLM so the comparison is deterministic. Do not spend the day on real model calls — the point is the fork/compare mechanics, not tuning.
- **Comparison is mechanical, not a judge.** "Outcome differs" is data; "which is better" is the judge/benchmark's job (Week 6). Do not put scoring logic here.
- **Tomorrow (Day 09):** Trajectory Resume — crash recovery + mid-run replay (Spec 3 §6.1).

---

*Prev: [Day 7 — Archive (90d) + Expiration; Hot/Cold Tier](day-07.md) | Next: [Day 9 — Trajectory Resume: Crash Recovery + Mid-run Replay](day-09.md)*
