# Day 06 — Canonical Task State Machine

| | |
|---|---|
| **Week** | 1 — Foundation |
| **Spec refs** | Spec 2 §3 (Task States), Spec 2 §4 (State Transition Rules) |
| **Estimated effort** | 6–7 hours |
| **Prerequisites** | Day 05 (DI container, bootstrap, boundary enforcement) |

---

## 1. Objectives

By end of day you will have:

1. A **single-source-of-truth state machine** (`TaskStateMachine`) in `packages/orchestrator` that owns every legal transition.
2. A **transition validator** that rejects illegal transitions with a descriptive error — not a silent no-op.
3. **State history** persisted to the DB on every transition (who/what/when/why).
4. A fully tested `TaskService` that exposes `createTask`, `transitionTask`, `getTask` — the only public API for task state changes.

The state machine is the heart of the Orchestrator. Every other subsystem (Agent Runtime, Verification Engine, Review) drives state changes *through* this machine — never around it.

---

## 2. Design Decisions

### 2.1 The 12 Canonical States (Spec 2 §3)

```typescript
export const TaskState = {
  PENDING:                      'PENDING',
  QUEUED:                       'QUEUED',
  EXECUTING:                    'EXECUTING',
  VERIFYING:                    'VERIFYING',
  AWAITING_REVIEW:              'AWAITING_REVIEW',
  APPROVED:                     'APPROVED',
  REJECTED:                     'REJECTED',
  REWORK:                       'REWORK',
  COMPLETED:                    'COMPLETED',
  FAILED:                       'FAILED',
  AWAITING_HUMAN_INTERVENTION:  'AWAITING_HUMAN_INTERVENTION',
  CANCELLED:                    'CANCELLED',
} as const;
export type TaskState = typeof TaskState[keyof typeof TaskState];
```

### 2.2 Legal Transition Table

This table is the **only** place transitions are defined. Do not scatter transition logic across service methods.

| From | To | Trigger |
|------|----|---------|
| `PENDING` | `QUEUED` | Orchestrator dispatches task |
| `PENDING` | `CANCELLED` | Human cancels |
| `QUEUED` | `EXECUTING` | Agent Runtime picks up task |
| `QUEUED` | `CANCELLED` | Human cancels |
| `EXECUTING` | `VERIFYING` | Agent Runtime emits `task.execution_finished` |
| `EXECUTING` | `FAILED` | Agent Runtime emits unrecoverable error |
| `EXECUTING` | `AWAITING_HUMAN_INTERVENTION` | Agent exceeds `maxSteps` or hits hard block |
| `VERIFYING` | `AWAITING_REVIEW` | Verification Engine emits `verification.completed` PASSED |
| `VERIFYING` | `REWORK` | Verification Engine emits `verification.completed` FAILED |
| `VERIFYING` | `FAILED` | Verification Engine emits `verification.completed` ERROR (infra failure) |
| `AWAITING_REVIEW` | `APPROVED` | Human submits approve decision |
| `AWAITING_REVIEW` | `REJECTED` | Human submits reject decision |
| `REWORK` | `QUEUED` | Orchestrator re-queues (increments `attempt_number`) |
| `REWORK` | `CANCELLED` | Human cancels |
| `REWORK` | `FAILED` | `attempt_number` exceeds `max_attempts` |
| `REJECTED` | `REWORK` | Human requests rework with rationale |
| `REJECTED` | `CANCELLED` | Human cancels |
| `AWAITING_HUMAN_INTERVENTION` | `QUEUED` | Human unblocks and re-queues |
| `AWAITING_HUMAN_INTERVENTION` | `CANCELLED` | Human cancels |
| `APPROVED` | `COMPLETED` | Artifact merged (commit SHA recorded) |
| `FAILED` | `QUEUED` | Human manually re-queues |
| `FAILED` | `CANCELLED` | Human cancels |
| `COMPLETED` | — | Terminal |
| `CANCELLED` | — | Terminal |

### 2.3 Transition Record

Every transition writes a row to `task_state_history`:

```typescript
interface TaskStateHistoryEntry {
  id:            string;          // UUIDv7
  task_id:       TaskID;
  from_state:    TaskState;
  to_state:      TaskState;
  triggered_by:  TriggeredBy;     // 'orchestrator'|'agent_runtime'|'verification_engine'|'human'
  trigger_event_id?: EventID;     // the event that caused this transition, if any
  rationale?:    string;          // required for human-driven transitions
  attempt_number: number;
  occurred_at:   Date;
}
```

**Why a separate history table?** The `tasks` table is the current-state projection. `task_state_history` is the audit trail. Provenance queries (Day 26) and the Observability layer (Day 27) both read from history, not from `event_log` directly — history is pre-joined and typed.

### 2.4 Concurrency Guard

Two concurrent processes must not transition the same task simultaneously. Use a **DB-level optimistic lock**:

```sql
UPDATE tasks
SET state = $new_state, updated_at = now()
WHERE id = $task_id
  AND state = $expected_from_state  -- optimistic lock
RETURNING *;
```

If zero rows are returned, another process won the race — throw `StateConflictError`. Do not retry automatically; let the caller decide.

### 2.5 `attempt_number` and Idempotency

`attempt_number` is incremented by the `REWORK → QUEUED` transition only. All other transitions preserve it. The `idempotency_key` on `tasks` is `task_id + ':' + attempt_number` — a duplicate dispatch for the same attempt is silently ignored (Spec 2 §9).

---

## 3. Tasks

### 3.1 Add `task_state_history` table (30 min)

- [ ] `packages/db/src/schema/task-state-history.ts`:

```typescript
export const taskStateHistory = pgTable('task_state_history', {
  id:               text('id').primaryKey(),
  task_id:          text('task_id').notNull().references(() => tasks.id),
  from_state:       text('from_state').notNull(),
  to_state:         text('to_state').notNull(),
  triggered_by:     text('triggered_by').notNull(),
  trigger_event_id: text('trigger_event_id'),
  rationale:        text('rationale'),
  attempt_number:   integer('attempt_number').notNull(),
  occurred_at:      timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  taskIdx: index('task_state_history_task_idx').on(t.task_id),
}));
```

- [ ] `pnpm --filter @harness/db generate` → review → `migrate`.

### 3.2 Implement `TaskStateMachine` (90 min)

- [ ] `packages/orchestrator/src/state-machine/task-state-machine.ts`:
  - `canTransition(from: TaskState, to: TaskState): boolean` — pure lookup in the transition table.
  - `legalTargets(from: TaskState): TaskState[]` — returns all valid targets for a given state.
  - `isTerminal(state: TaskState): boolean` — `COMPLETED` and `CANCELLED`.
  - `requiresRationale(from: TaskState, to: TaskState): boolean` — true for all human-driven transitions except `APPROVED → COMPLETED`.
- [ ] The transition table is a `ReadonlyMap<string, ReadonlySet<TaskState>>` keyed by `from_state`. Build it once at module load.

### 3.3 Implement `TransitionError` types (30 min)

- [ ] `packages/orchestrator/src/state-machine/errors.ts`:
  - `IllegalTransitionError` — fields: `task_id`, `from_state`, `to_state`, `legal_targets`.
  - `StateConflictError` — fields: `task_id`, `expected_state`, `actual_state`.
  - `TerminalStateError` — subclass of `IllegalTransitionError` for transitions from terminal states.
  - `MissingRationaleError` — for human transitions that require a rationale.

### 3.4 Implement `TaskService` (120 min)

- [ ] `packages/orchestrator/src/task-service.ts`:

```typescript
export class TaskService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly sm: TaskStateMachine,
  ) {}

  async createTask(input: CreateTaskInput): Promise<Task> { ... }

  async transitionTask(
    taskId: TaskID,
    toState: TaskState,
    triggeredBy: TriggeredBy,
    opts?: { rationale?: string; triggerEventId?: EventID }
  ): Promise<Task> {
    // 1. Load current task
    // 2. Validate: sm.canTransition(current.state, toState)
    //    → throw IllegalTransitionError if not
    // 3. Validate: sm.requiresRationale(...) && !opts?.rationale
    //    → throw MissingRationaleError
    // 4. If toState === QUEUED && current.state === REWORK:
    //    increment attempt_number, regenerate idempotency_key
    // 5. Optimistic-lock UPDATE (§2.4) → throw StateConflictError if 0 rows
    // 6. Insert task_state_history row
    // 7. Publish task.state_changed event
    // 8. Return updated task
  }

  async getTask(taskId: TaskID): Promise<Task | null> { ... }
  async getTaskHistory(taskId: TaskID): Promise<TaskStateHistoryEntry[]> { ... }
}
```

### 3.5 Register in DI container (15 min)

- [ ] Update `apps/api/src/bootstrap.ts` — replace the `Orchestrator` stub:

```typescript
c.register(TOKENS.TaskStateMachine, () => new TaskStateMachine());
c.register(TOKENS.TaskService, (c) => new TaskService(
  c.resolve(TOKENS.Db),
  c.resolve(TOKENS.EventBus),
  c.resolve(TOKENS.TaskStateMachine),
));
```

- [ ] Add `TaskStateMachine` and `TaskService` to `TOKENS`.
- [ ] Update `docs/architecture/wiring-map.md`.

### 3.6 Tests (120 min)

File: `packages/orchestrator/src/__tests__/task-state-machine.test.ts`

- [ ] Every transition in the §2.2 table passes `canTransition`.
- [ ] Every transition NOT in the §2.2 table fails `canTransition` (spot-check at least 20 illegal pairs).
- [ ] `isTerminal` returns true for `COMPLETED` and `CANCELLED`, false for all others.
- [ ] `legalTargets(PENDING)` returns exactly `[QUEUED, CANCELLED]`.
- [ ] `requiresRationale(REJECTED, REWORK)` is true; `requiresRationale(APPROVED, COMPLETED)` is false.

File: `packages/orchestrator/src/__tests__/task-service.test.ts`

- [ ] `createTask` inserts a row with state `PENDING` and a valid UUIDv7 `id`.
- [ ] `transitionTask(PENDING → QUEUED)` succeeds; `tasks.state` updated; history row inserted; `task.state_changed` event published (spy on bus).
- [ ] `transitionTask(PENDING → EXECUTING)` throws `IllegalTransitionError` with `legal_targets` in the error message.
- [ ] `transitionTask(COMPLETED → QUEUED)` throws `TerminalStateError`.
- [ ] `transitionTask(REWORK → QUEUED)` increments `attempt_number` and updates `idempotency_key`.
- [ ] `transitionTask` with a stale `expected_from_state` throws `StateConflictError` (simulate concurrent update).
- [ ] Human transition without rationale throws `MissingRationaleError`.
- [ ] `getTaskHistory` returns entries in `occurred_at ASC` order.
- [ ] Duplicate `task_id + attempt_number` idempotency key insert is rejected by DB constraint.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/task-state-history.ts` | History table |
| `packages/db/migrations/0001_*.sql` | History table migration |
| `packages/orchestrator/src/state-machine/task-state-machine.ts` | `TaskStateMachine` |
| `packages/orchestrator/src/state-machine/errors.ts` | All error types |
| `packages/orchestrator/src/task-service.ts` | `TaskService` |
| `apps/api/src/bootstrap.ts` (updated) | Real `TaskService` registration |
| `packages/orchestrator/src/__tests__/task-state-machine.test.ts` | Machine unit tests |
| `packages/orchestrator/src/__tests__/task-service.test.ts` | Service integration tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/orchestrator test` — all tests pass.
- [ ] `pnpm --filter @harness/orchestrator build` — clean build.
- [ ] `pnpm lint` — zero boundary violations.
- [ ] `grep -r "from '@harness" packages/orchestrator/src` shows only `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`.
- [ ] All 12 canonical states appear in the `tasks.state` CHECK constraint in the DB (verify with `psql \d tasks`).
- [ ] All 22 transitions in §2.2 have a corresponding passing test.
- [ ] `REWORK → QUEUED` increments `attempt_number` (test proves this).
- [ ] `task_state_history` row is written for every successful transition (test proves this).
- [ ] `task.state_changed` event is published with correct `from_state`, `to_state`, `triggered_by` (spy assertion).
- [ ] `docs/architecture/wiring-map.md` updated with `TaskStateMachine` and `TaskService`.

---

## 6. Notes & Pitfalls

- **The transition table in §2.2 is the spec.** If you are unsure whether a transition is legal, check Spec 2 §4 — do not infer from context. When in doubt, reject.
- **Do not add a `reset` transition** (`COMPLETED → PENDING`). Completed is terminal. If a task needs re-execution, create a new task.
- **`triggered_by: 'human'` requires a `reviewer_id` in the payload.** The `transitionTask` signature does not yet include this — add `opts.reviewerId?: string` and require it when `triggeredBy === 'human'`. This is used for the audit trail.
- **Do not catch `StateConflictError` inside `transitionTask`.** Let it propagate. The caller (Orchestrator dispatch loop, Day 08) is the right place to decide whether to retry or abort.
- **`task.state_changed` event payload:** use `TaskStateChangedPayload` from Day 03. `correlation_id` = `task_id` (the task is always the correlation root for its own lifecycle).
- **Terminal states and the Orchestrator loop:** the dispatch loop (Day 08) must filter out terminal tasks when polling. A `WHERE state NOT IN ('COMPLETED', 'CANCELLED')` clause is the minimum guard.
- **Tomorrow (Day 07):** Week 1 integration checkpoint. All packages built so far will be wired together and smoke-tested end-to-end for the first time.

---

*Prev: [Day 05 — Module Boundaries, DI & Dependency Enforcement](day-05.md) | Next: [Day 07 — Week 1 Integration Checkpoint](day-07.md)*
