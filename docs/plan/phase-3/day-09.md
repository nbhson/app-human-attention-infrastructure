# Day 09 — Trajectory Resume: Crash Recovery + Mid-run Replay

| | |
|---|---|
| **Week** | 2 — Memory lifecycle + trajectory |
| **Spec refs** | Spec 3 §6.1 (Trajectory Operations — Resume, Replay), §6 (event-sourced entity, durable step commits) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 08 (Trajectory Fork — head-to-head comparison) |

---

## 1. Objectives

By end of day you will have:

1. A **Resume operation**: continue an interrupted run from its last committed step instead of restarting (Spec 3 §6.1 — crash recovery, long tasks).
2. **Durable step commits**: every step is persisted as it happens (append-ordered, idempotent per run), so "last committed step" is unambiguous after a crash.
3. **Replay**: re-materialize any past run step-by-step from stored `steps[]` (the operation Phase 2's A/B harness already leans on, now exposed cleanly).
4. Crash-recovery wiring: a reconciler detects interrupted runs and resumes (or escalates) them without double-executing committed steps.

Resume is the "current state = replay of the stream" consequence of event sourcing (Spec 3 §6.1 note).

---

## 2. Design Decisions

### 2.1 Step commit = append to the store (event-sourced)

A step is "committed" the moment it is appended to `trajectory_steps` with its monotonic `step_index`. There is no separate in-memory "current state" blob — Spec 3 §6.1: *"every mutation is an append; 'current state' is a replay of the stream."*

```typescript
interface StepRecord {
  runId: string;
  stepIndex: number;        // run-scoped monotonic counter
  type: 'THOUGHT' | 'TOOL_CALL' | 'OBSERVATION' | 'FINAL';
  toolInput?: unknown;
  toolOutput?: unknown;
  promptHash: string;
  modelUsed: string;
}
```

Resume reads `MAX(step_index)` for the run and continues from `step_index + 1`. Idempotency: re-committing step `i` updates nothing (unique `(runId, stepIndex)`); the resume loop starts strictly after the max.

### 2.2 Resume API

```typescript
// packages/agent-runtime/src/trajectory/resume.ts
export class TrajectoryResumeService {
  constructor(
    private readonly runtime: IAgentRuntime,
    private readonly store: TrajectoryStore,
    private readonly bus: IEventBus,
  ) {}

  async resume(runId: string, opts?: { maxSteps?: number }): Promise<AgentExecutionResult> {
    // 1. Load committed steps; lastIndex = max(stepIndex)
    // 2. If run already terminal → return existing result (no-op resume)
    // 3. Resume loop from lastIndex+1 under the SAME model/prompt/context (rehydrated from the run record)
    // 4. Append new steps durally as they occur
    // 5. Publish trajectory.resumed { runId, fromStepIndex }
  }
}
```

**Same config, not a fork:** resume rehydrates the *original* `model_used`/`prompt_hash`/context from the run record (which must be stored with the run, not just the steps — see §2.4). A resume that changes configuration is a fork (Day 08), not a resume.

### 2.3 Replay API (clean exposure of the Phase-2 path)

```typescript
export class TrajectoryReplayService {
  async replay(runId: string): Promise<AgentRunTrajectory> {
    // re-materialize from stored steps in step_index order — no execution, no external calls
  }
}
```

Replay is a read-only projection. It is the substrate for the A/B shadow harness (Spec 11 §5) and for audit. It must return byte-identical step content to what was recorded.

### 2.4 Run record must carry a rehydratable config

To resume *identically*, the run record needs more than steps. Add `model_used`, `prompt_hash`, `context_ref` (context snapshot id), `allowed_tools`, `max_steps` to the run header (the trajectory already has `modelUsed`/`promptHash`; ensure they are **persisted at run start**, not only at finalize). If a run's config was never persisted, resume is impossible — fail loudly, don't guess.

### 2.5 Crash recovery reconciler

A `RunReconciler` (runs on startup and periodically) finds runs whose last event is `running`/`started` but which never emitted `finished`/`failed` past a heartbeat window, and:

1. Resumes them (bounded by `max_steps`).
2. Or, if the run has exceeded its budget/heartbeat, escalates to `AWAITING_HUMAN_INTERVENTION` (reuse the Phase 1 orphan-recover path from Spec 2 §7).

Emits `trajectory.run_recovered { runId, action: 'resumed' | 'escalated' }`.

---

## 3. Tasks

### 3.1 Run-header persistence (60 min)

- [ ] Ensure run header persists `model_used`, `prompt_hash`, `context_ref`, `allowed_tools`, `max_steps` **at run start**.
- [ ] Migration if any of these are missing from the Phase 1 `agent_runs` table.
- [ ] Test: a run record created is immediately resumable (config present before any step).

### 3.2 Durable step commits (60 min)

- [ ] Audit the `TrajectoryRecorder` (Phase 1) — confirm every step appends to the store at emit time (not a batch flush at completion). If it flushes at completion, refactor to write-as-you-go.
- [ ] Test: a step is readable from the store immediately after emit (before run completion).

### 3.3 `TrajectoryResumeService` (120 min)

- [ ] Implement `resume()` per §2.2 (MockLLM in tests).
- [ ] No-op resume of a terminal run; resume of `fromStepIndex` correctness.

### 3.4 `TrajectoryReplayService` (60 min)

- [ ] Implement `replay()`; assert byte-identical content vs recorded steps.
- [ ] Reuse by any existing Phase-2 A/B harness entry point (wire if cheap, note if not).

### 3.5 `RunReconciler` (90 min)

- [ ] Detects interrupted runs (heartbeat window); resumes or escalates.
- [ ] Test: kill a run after step 2 (simulate), reconcile, assert steps 0–2 are not re-executed and step 3 is executed once.

### 3.6 Integration tests (90 min)

- [ ] Resume-after-crash E2E: start → 2 steps → "crash" → resume → completes with contiguous, non-duplicated steps.
- [ ] Idempotency: committing step `i` twice does not duplicate (unique `(runId, stepIndex)`).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/agent-runtime/src/trajectory/resume.ts` | `TrajectoryResumeService` |
| `packages/agent-runtime/src/trajectory/replay.ts` | `TrajectoryReplayService` |
| `packages/agent-runtime/src/trajectory/reconciler.ts` | `RunReconciler` |
| `packages/agent-runtime/src/trajectory/recorder.ts` (updated) | write-as-you-go step commits |
| `packages/db/src/schema/*.ts` + migration | run-header config columns |
| `packages/agent-runtime/src/__tests__/resume.test.ts` | Resume + replay + reconciler tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/agent-runtime test` — all tests pass.
- [ ] A step is durable (readable from store) immediately after emit — no completion-time flush.
- [ ] `resume()` continues from `MAX(step_index)+1`; committed steps are never re-executed.
- [ ] Resuming a terminal run is a no-op returning the existing result.
- [ ] Resume rehydrates the original `model_used`/`prompt_hash`/context — no config guessing.
- [ ] `replay()` returns a byte-identical trajectory to what was recorded.
- [ ] `RunReconciler` recovers an interrupted run (resume or escalate) and emits `trajectory.run_recovered`.
- [ ] Step writes are idempotent per `(runId, stepIndex)` (double-commit test).

---

## 6. Notes & Pitfalls

- **Write-as-you-go is the load-bearing change.** If the Phase 1 recorder batches steps to "flush on completion," resume is impossible — a crash loses the tail. This refactor is the day's real work; treat it as the deliverable.
- **Resume is NOT a fork.** Same config, just later. If you touch `overrides`, you've wandered into Day 08 territory. Keep the two services separate so the distinction stays obvious in code.
- **Run header is the resume contract.** Persist config at run *start*. A missing `context_ref` at resume time means you cannot rehydrate context — fail loudly rather than resume with an empty context.
- **Heartbeat window tuning.** If the reconciler's window is too short, it "recovers" runs that are just slow (double execution). If too long, genuinely dead runs sit unresolved. Start wide (e.g. 2× the p95 run duration) and tighten with Day 37's load data.
- **Contiguous step indices after a gap.** Guard against a missed step (e.g. step 3 committed, step 4 skipped by a crash in the recorder). Resume from `max+1` tolerates this; do not assume indices are always contiguous.
- **Tomorrow (Day 10):** Week 2 checkpoint — consolidation/decay validated against the decision log.

---

*Prev: [Day 8 — Trajectory Fork: Head-to-head Model/Prompt/Context Comparison](day-08.md) | Next: [Day 10 — Week 2 Checkpoint: Consolidation/Decay Validated Against the Decision Log](day-10.md)*
