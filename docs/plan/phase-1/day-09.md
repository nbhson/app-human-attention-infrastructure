# Day 09 — Linear Workflow Execution

| | |
|---|---|
| **Week** | 2 — Execution Core |
| **Spec refs** | Spec 2 §4 (Workflow Model), Spec 2 §7 (Step Execution), Spec 2 §10 (Orchestrator Responsibilities) |
| **Estimated effort** | 7–8 hours |
| **Prerequisites** | Day 08 (Dispatcher + DispatchLoop green) |

---

## 1. Objectives

By end of day you will have:

1. A **`WorkflowDefinition`** — a declarative, ordered list of steps for a task type.
2. A **Phase 1 linear workflow**: `COLLECT_CONTEXT → EXECUTE → VERIFY` (3 steps, no branching, no parallelism).
3. A **`WorkflowRunner`** that executes steps in order and records per-step outcomes in a `task_step_log` table.
4. **Step-level failure handling** — a failed step immediately transitions the task to `AWAITING_HUMAN_INTERVENTION` (no silent swallowing).
5. Clear separation: the `WorkflowRunner` **orchestrates**; it never *does* the work itself (Context Engine / Agent Runtime / Verification Engine do).

> **Note:** The `WorkflowRunner` is the Orchestrator's second component (after `Dispatcher`). It is **not** triggered by polling — it is called by the Agent Runtime's completion handler (Day 12). Today's job is to build and test it in isolation, with stub engines.

---

## 2. Design Decisions

### 2.1 Declarative Workflow Definition

Workflows are data, not code. This makes them inspectable, versionable, and (in Phase 2) user-configurable:

```typescript
// packages/orchestrator/src/workflow/workflow-definition.ts

export const StepKind = {
  COLLECT_CONTEXT: 'COLLECT_CONTEXT',
  EXECUTE:         'EXECUTE',
  VERIFY:          'VERIFY',
} as const;
export type StepKind = typeof StepKind[keyof typeof StepKind];

export interface WorkflowStep {
  kind: StepKind;
  /** Human-readable label for logs and UI. */
  label: string;
  /** Step-level timeout in ms. 0 = no timeout. */
  timeoutMs: number;
}

export interface WorkflowDefinition {
  id: string;           // e.g. 'linear-v1'
  version: number;      // bump on any step change
  steps: WorkflowStep[]; // executed in array order — no branching in Phase 1
}

/** The single Phase 1 workflow. */
export const LINEAR_WORKFLOW_V1: WorkflowDefinition = {
  id: 'linear-v1',
  version: 1,
  steps: [
    { kind: 'COLLECT_CONTEXT', label: 'Collect Context',  timeoutMs: 30_000 },
    { kind: 'EXECUTE',         label: 'Execute with Agent', timeoutMs: 300_000 },
    { kind: 'VERIFY',          label: 'Verify Artifacts',  timeoutMs: 120_000 },
  ],
};
```

**Why declarative?** When Phase 2 adds conditional steps (e.g. "skip VERIFY for docs-only tasks"), you add a `condition` field to `WorkflowStep` — not a tangle of `if` statements in the runner.

### 2.2 Step Execution Contract

Each step kind maps to exactly one engine call. The `WorkflowRunner` holds a **step handler registry** — a `Map<StepKind, StepHandler>`:

```typescript
// packages/orchestrator/src/workflow/step-handler.ts

export interface StepContext {
  taskId: TaskID;
  workflowId: string;
  stepIndex: number;
}

export type StepResult =
  | { ok: true;  output: Record<string, unknown> }
  | { ok: false; error: string; retriable: boolean };

export type StepHandler = (ctx: StepContext) => Promise<StepResult>;
```

Handlers are registered at bootstrap time. In Phase 1 they are **stubs** that return `{ ok: true, output: {} }` — real implementations land on Days 12 (EXECUTE), 15 (VERIFY), and 20 (COLLECT_CONTEXT).

**Why stubs first?** You can test the full runner state machine today without waiting for the engines. This is the key advantage of the handler registry pattern.

### 2.3 `task_step_log` — Per-Step Audit Trail

Every step execution writes a row. This is the primary debugging tool when a task goes to `AWAITING_HUMAN_INTERVENTION`:

```typescript
// packages/db/src/schema/task-step-log.ts

export const taskStepLog = pgTable('task_step_log', {
  id:             text('id').primaryKey(),                        // UUIDv7
  task_id:        text('task_id').notNull().references(() => tasks.id),
  workflow_id:    text('workflow_id').notNull(),
  workflow_ver:   integer('workflow_ver').notNull(),
  step_index:     integer('step_index').notNull(),
  step_kind:      text('step_kind').notNull(),                    // StepKind
  status:         text('status').notNull(),                       // 'STARTED' | 'COMPLETED' | 'FAILED'
  output:         jsonb('output'),                                // StepResult.output or error
  started_at:     timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finished_at:    timestamp('finished_at', { withTimezone: true }),
});
```

**Rule:** Insert the `STARTED` row *before* calling the handler; update to `COMPLETED`/`FAILED` after. If the process crashes mid-step, you can see exactly which step was in flight.

### 2.4 Failure Handling — Fail Loudly

When a step handler returns `{ ok: false }`:

```
StepResult.ok === false
  → update task_step_log row to FAILED (with error message)
  → transitionTask(taskId, 'AWAITING_HUMAN_INTERVENTION', 'orchestrator')
  → return (stop executing further steps)
```

Do **not** retry inside the runner (retry policy is Day 10). Do **not** continue to the next step after a failure.

### 2.5 Runner Entry Point

```typescript
// packages/orchestrator/src/workflow/workflow-runner.ts

export class WorkflowRunner {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly taskService: TaskService,
    private readonly handlers: Map<StepKind, StepHandler>,
  ) {}

  async run(taskId: TaskID, workflow: WorkflowDefinition): Promise<void> {
    for (const [i, step] of workflow.steps.entries()) {
      const ctx: StepContext = { taskId, workflowId: workflow.id, stepIndex: i };
      // 1. Insert STARTED row into task_step_log
      // 2. Look up handler for step.kind
      // 3. Call handler(ctx) with step.timeoutMs timeout
      // 4. On ok=true:  update row to COMPLETED, continue loop
      // 5. On ok=false: update row to FAILED, transition to AWAITING_HUMAN_INTERVENTION, return
      // 6. On timeout:  treat as ok=false with error='STEP_TIMEOUT'
    }
    // All steps completed — task stays in EXECUTING; Runtime's completion handler (Day 12) takes over
  }
}
```

---

## 3. Tasks

### 3.1 Add `task_step_log` table (30 min)

- [ ] `packages/db/src/schema/task-step-log.ts` — as per §2.3.
- [ ] Export from `packages/db/src/schema/index.ts`.
- [ ] `pnpm --filter @harness/db generate` → review SQL → `migrate`.
- [ ] Confirm table appears: `docker exec harness-postgres psql -U postgres -d harness -c "\d task_step_log"`.

### 3.2 Implement `WorkflowDefinition` + `LINEAR_WORKFLOW_V1` (30 min)

- [ ] `packages/orchestrator/src/workflow/workflow-definition.ts` — as per §2.1.
- [ ] Export from `packages/orchestrator/src/index.ts`.
- [ ] Add a unit test: `LINEAR_WORKFLOW_V1.steps` has exactly 3 entries in the expected order.

### 3.3 Implement `StepContext`, `StepResult`, `StepHandler` types (20 min)

- [ ] `packages/orchestrator/src/workflow/step-handler.ts` — as per §2.2.
- [ ] Export from `packages/orchestrator/src/index.ts`.

### 3.4 Implement `WorkflowRunner` (150 min)

- [ ] `packages/orchestrator/src/workflow/workflow-runner.ts` — as per §2.5.
- [ ] Implement step timeout with `Promise.race` + `AbortController`:

```typescript
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms === 0) return p;
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('STEP_TIMEOUT')), ms));
  return Promise.race([p, timeout]);
}
```

- [ ] On timeout catch: map `Error('STEP_TIMEOUT')` to `{ ok: false, error: 'STEP_TIMEOUT', retriable: true }`.
- [ ] Write `STARTED` → `COMPLETED`/`FAILED` rows at each step (§2.3).

### 3.5 Register `WorkflowRunner` in DI (30 min)

- [ ] Add `TOKENS.WorkflowRunner` to `TOKENS`.
- [ ] `apps/api/src/bootstrap.ts`:

```typescript
c.register(TOKENS.WorkflowRunner, (c) => {
  const handlers = new Map<StepKind, StepHandler>([
    // Phase 1 stubs — replaced on Days 12, 15, 20
    ['COLLECT_CONTEXT', async () => ({ ok: true, output: { stub: true } })],
    ['EXECUTE',         async () => ({ ok: true, output: { stub: true } })],
    ['VERIFY',          async () => ({ ok: true, output: { stub: true } })],
  ]);
  return new WorkflowRunner(
    c.resolve(TOKENS.Db),
    c.resolve(TOKENS.EventBus),
    c.resolve(TOKENS.TaskService),
    handlers,
  );
});
```

- [ ] Update `docs/architecture/wiring-map.md`.

### 3.6 Tests (180 min)

File: `packages/orchestrator/src/__tests__/workflow-runner.test.ts`

- [ ] `run` executes all 3 steps in order (assert `task_step_log` has 3 rows, all `COMPLETED`, `step_index` 0/1/2).
- [ ] `run` writes a `STARTED` row before the handler is called (spy on insert order).
- [ ] `run` with a failing step 0: only 1 `FAILED` row, task transitions to `AWAITING_HUMAN_INTERVENTION`, steps 1 and 2 never run.
- [ ] `run` with a failing step 1: rows for step 0 (`COMPLETED`) and step 1 (`FAILED`); step 2 never runs.
- [ ] `run` with a step that throws (not `ok:false` — an actual exception): treated as `ok:false`, task transitions correctly.
- [ ] `run` with a step that exceeds `timeoutMs`: `STEP_TIMEOUT` error recorded, task transitions to `AWAITING_HUMAN_INTERVENTION`.
- [ ] `run` does not transition task state when all steps succeed (task stays `EXECUTING` — Runtime handler owns the next transition).
- [ ] `LINEAR_WORKFLOW_V1` has `steps[0].kind === 'COLLECT_CONTEXT'`, `steps[1].kind === 'EXECUTE'`, `steps[2].kind === 'VERIFY'`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/task-step-log.ts` | Step audit table |
| `packages/db/migrations/0003_*.sql` | Migration for task_step_log |
| `packages/orchestrator/src/workflow/workflow-definition.ts` | `WorkflowDefinition`, `LINEAR_WORKFLOW_V1` |
| `packages/orchestrator/src/workflow/step-handler.ts` | `StepContext`, `StepResult`, `StepHandler` |
| `packages/orchestrator/src/workflow/workflow-runner.ts` | `WorkflowRunner` |
| `apps/api/src/bootstrap.ts` (updated) | `WorkflowRunner` registration with stub handlers |
| `packages/orchestrator/src/__tests__/workflow-runner.test.ts` | Runner tests |
| `docs/architecture/wiring-map.md` (updated) | WorkflowRunner wiring |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/orchestrator test` — all tests pass.
- [ ] `pnpm --filter @harness/orchestrator build` — clean build.
- [ ] `pnpm lint` — zero boundary violations.
- [ ] `task_step_log` table exists with correct columns.
- [ ] `LINEAR_WORKFLOW_V1` has exactly 3 steps in the order `COLLECT_CONTEXT → EXECUTE → VERIFY`.
- [ ] Failing step test: task lands in `AWAITING_HUMAN_INTERVENTION`, subsequent steps do not run.
- [ ] Timeout test: `STEP_TIMEOUT` recorded in `task_step_log.output`.
- [ ] `docs/architecture/wiring-map.md` updated.

---

## 6. Notes & Pitfalls

- **Do not retry inside `WorkflowRunner`.** Retry policy (with backoff, attempt counting) is Day 10's job. Today, any failure goes straight to `AWAITING_HUMAN_INTERVENTION`.
- **`task_step_log.started_at` uses `defaultNow()`.** Do not set it explicitly in the insert — let Postgres timestamp it.
- **Stub handlers return `{ ok: true }`.** They will be replaced one by one as engines come online. Keep the stub map in `bootstrap.ts`, not inside `WorkflowRunner` — the runner should not know about stubs.
- **The runner does not publish events directly.** State transitions publish `task.state_changed` via `TaskService`. Step-level events (e.g. `task.step_started`) are Phase 2.
- **`step_index` is 0-based.** Be consistent — the test at §3.6 asserts `0/1/2`, not `1/2/3`.
- **Tomorrow (Day 10):** Retry policy, failure classification, and full idempotency hardening — the runner gets smarter about *when* to retry vs. escalate.

---

*Prev: [Day 08 — Orchestrator Core: Queue & Pull Dispatch](day-08.md) | Next: [Day 10 — Retry, Failure & Idempotency](day-10.md)*
