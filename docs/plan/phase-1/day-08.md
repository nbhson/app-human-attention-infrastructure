# Day 08 — Orchestrator Core: Queue & Pull Dispatch

| | |
|---|---|
| **Week** | 2 — Execution Core |
| **Spec refs** | Spec 2 §5 (Dispatch Model), Spec 2 §6 (Queue Semantics), Spec 2 §9 (Idempotency) |
| **Estimated effort** | 7–8 hours |
| **Prerequisites** | Day 07 (Week 1 checkpoint green) |

---

## 1. Objectives

By end of day you will have:

1. A **DB-backed task queue** — no external broker, PostgreSQL is the queue.
2. A **`Dispatcher`** that polls for `PENDING`/`REWORK` tasks and drives them to `QUEUED`.
3. A **`WorkerPool`** (Phase 1: single worker, sequential) that picks up `QUEUED` tasks and transitions them to `EXECUTING`.
4. **Idempotent dispatch** — a duplicate dispatch for the same `task_id + attempt_number` is silently ignored.
5. A `DispatchLoop` lifecycle (start/stop) wired into `apps/api` startup.

The dispatch model is **pull-based** (Spec 2 §5): workers pull tasks from the DB queue; the Orchestrator does not push. This eliminates an entire class of lost-message bugs in Phase 1.

---

## 2. Design Decisions

### 2.1 PostgreSQL as the Queue

Phase 1 uses `SELECT ... FOR UPDATE SKIP LOCKED` — the standard Postgres job-queue pattern:

```sql
SELECT id FROM tasks
WHERE state = 'PENDING'
   OR (state = 'REWORK' AND attempt_number < max_attempts)
ORDER BY created_at ASC
LIMIT $batch_size
FOR UPDATE SKIP LOCKED;
```

**Why not Redis/BullMQ in Phase 1?** The DB is already running. `SKIP LOCKED` gives atomic claim semantics without a new dependency. Phase 2 adds a real broker when throughput demands it.

### 2.2 Dispatch vs. Execution

The Orchestrator has exactly two responsibilities today:

| Step | Action | Transition |
|------|--------|-----------|
| Dispatch | Move `PENDING`/`REWORK` → `QUEUED` | `task.state_changed` |
| Handoff | Signal Agent Runtime that a task is `QUEUED` | (no transition — Runtime pulls) |

The Orchestrator does **not** call Agent Runtime directly. It transitions state and publishes the event. Agent Runtime's own poll loop (Day 12) picks up `QUEUED` tasks. This keeps the dependency direction clean.

### 2.3 Idempotent Dispatch (Spec 2 §9)

Before transitioning `PENDING → QUEUED`, check whether a dispatch for `task_id + attempt_number` has already been recorded:

```typescript
const key = `${taskId}:${attemptNumber}`;
const exists = await db.select().from(dispatchLog).where(eq(dispatchLog.idempotency_key, key));
if (exists.length > 0) return; // silently skip — already dispatched
```

Add a `dispatch_log` table today. It is small, cheap, and makes idempotency auditable.

### 2.4 `max_attempts`

Add `max_attempts integer not null default 3` to the `tasks` table. When `attempt_number >= max_attempts` and a `REWORK` transition is requested, transition to `FAILED` instead of `QUEUED`.

### 2.5 DispatchLoop Lifecycle

```typescript
class DispatchLoop {
  start(intervalMs = 2000): void  // setInterval-based poll
  stop(): void                    // clearInterval; wait for in-flight dispatch to finish
  get running(): boolean
}
```

The loop is started in `apps/api/src/index.ts` after `buildContainer()`. It is stopped on `SIGTERM`/`SIGINT`. In tests, start and stop it manually per test case.

---

## 3. Tasks

### 3.1 Add `dispatch_log` table + `max_attempts` column (45 min)

- [ ] `packages/db/src/schema/dispatch-log.ts`:

```typescript
export const dispatchLog = pgTable('dispatch_log', {
  id:               text('id').primaryKey(),
  task_id:          text('task_id').notNull().references(() => tasks.id),
  attempt_number:   integer('attempt_number').notNull(),
  idempotency_key:  text('idempotency_key').notNull().unique(),
  dispatched_at:    timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] Alter `tasks` table: add `max_attempts integer not null default 3`.
- [ ] `pnpm --filter @harness/db generate` → review → `migrate`.

### 3.2 Implement `Dispatcher` (120 min)

- [ ] `packages/orchestrator/src/dispatch/dispatcher.ts`:

```typescript
export class Dispatcher {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly taskService: TaskService,
  ) {}

  async dispatchPending(batchSize = 10): Promise<DispatchResult> {
    // 1. SELECT ... FOR UPDATE SKIP LOCKED (§2.1)
    // 2. For each task:
    //    a. Check dispatch_log idempotency (§2.3) → skip if already dispatched
    //    b. If state === REWORK && attempt_number >= max_attempts:
    //       transitionTask(taskId, 'FAILED', 'orchestrator') → continue
    //    c. transitionTask(taskId, 'QUEUED', 'orchestrator')
    //    d. Insert dispatch_log row
    // 3. Return { dispatched: number, skipped: number, failed: number }
  }
}
```

### 3.3 Implement `DispatchLoop` (60 min)

- [ ] `packages/orchestrator/src/dispatch/dispatch-loop.ts` — as per §2.5.
- [ ] Log each poll cycle at `debug` level: `{ polled, dispatched, skipped, failed }`.
- [ ] On `Dispatcher` throwing an unexpected error: log at `error` level, continue loop (do not crash the process).

### 3.4 Wire into `apps/api` (30 min)

- [ ] `apps/api/src/bootstrap.ts` — register `Dispatcher` and `DispatchLoop`:

```typescript
c.register(TOKENS.Dispatcher, (c) => new Dispatcher(
  c.resolve(TOKENS.Db),
  c.resolve(TOKENS.EventBus),
  c.resolve(TOKENS.TaskService),
));
c.register(TOKENS.DispatchLoop, (c) => new DispatchLoop(c.resolve(TOKENS.Dispatcher)));
```

- [ ] `apps/api/src/index.ts`:

```typescript
const dispatchLoop = container.resolve<DispatchLoop>(TOKENS.DispatchLoop);
dispatchLoop.start(2000);
process.on('SIGTERM', () => { dispatchLoop.stop(); process.exit(0); });
process.on('SIGINT',  () => { dispatchLoop.stop(); process.exit(0); });
```

- [ ] Add `Dispatcher` and `DispatchLoop` to `TOKENS`.
- [ ] Update `docs/architecture/wiring-map.md`.

### 3.5 Tests (150 min)

File: `packages/orchestrator/src/__tests__/dispatcher.test.ts`

- [ ] `dispatchPending` transitions a `PENDING` task to `QUEUED` and inserts a `dispatch_log` row.
- [ ] `dispatchPending` on an already-dispatched `task_id + attempt_number` is a silent no-op (idempotency).
- [ ] `dispatchPending` skips `QUEUED`, `EXECUTING`, `COMPLETED`, `CANCELLED` tasks.
- [ ] `dispatchPending` transitions `REWORK` task to `QUEUED` when `attempt_number < max_attempts`.
- [ ] `dispatchPending` transitions `REWORK` task to `FAILED` when `attempt_number >= max_attempts`.
- [ ] `dispatchPending` respects `batchSize` limit.
- [ ] Two concurrent `dispatchPending` calls do not double-dispatch the same task (SKIP LOCKED test).
- [ ] `task.state_changed` event published with `from_state=PENDING`, `to_state=QUEUED`, `triggered_by=orchestrator`.

File: `packages/orchestrator/src/__tests__/dispatch-loop.test.ts`

- [ ] `start()` triggers `dispatchPending` on the first tick.
- [ ] `stop()` prevents further ticks.
- [ ] An unexpected `Dispatcher` error does not stop the loop (spy on next tick).
- [ ] `running` is `false` after `stop()`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/dispatch-log.ts` | Dispatch log table |
| `packages/db/migrations/0002_*.sql` | Migration for dispatch_log + max_attempts |
| `packages/orchestrator/src/dispatch/dispatcher.ts` | `Dispatcher` |
| `packages/orchestrator/src/dispatch/dispatch-loop.ts` | `DispatchLoop` |
| `apps/api/src/bootstrap.ts` (updated) | Real registrations |
| `apps/api/src/index.ts` (updated) | Loop start/stop |
| `packages/orchestrator/src/__tests__/dispatcher.test.ts` | Dispatcher tests |
| `packages/orchestrator/src/__tests__/dispatch-loop.test.ts` | Loop tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/orchestrator test` — all tests pass.
- [ ] `pnpm --filter @harness/orchestrator build` — clean build.
- [ ] `pnpm lint` — zero boundary violations.
- [ ] `dispatch_log` table exists and has a unique constraint on `idempotency_key`.
- [ ] `tasks.max_attempts` column exists with default `3`.
- [ ] Idempotency test passes: duplicate dispatch is silently skipped.
- [ ] SKIP LOCKED concurrency test passes: no double-dispatch under concurrent polling.
- [ ] `DispatchLoop` starts and stops cleanly in the API process.
- [ ] `docs/architecture/wiring-map.md` updated.

---

## 6. Notes & Pitfalls

- **Do not use `setTimeout` recursion for the loop.** `setInterval` is simpler and correct here. The in-flight guard (a boolean flag) prevents overlapping ticks.
- **`SKIP LOCKED` requires a transaction.** Wrap the `SELECT ... FOR UPDATE SKIP LOCKED` in `db.transaction()`. Outside a transaction, Postgres releases the lock immediately and the pattern breaks.
- **`REWORK → FAILED` is a state machine transition.** Use `taskService.transitionTask`, not a raw `UPDATE`. The history row and event must be written.
- **Do not call Agent Runtime from `Dispatcher`.** The Runtime polls `QUEUED` tasks independently (Day 12). If you find yourself wanting to "notify" the Runtime, publish a `task.state_changed` event — that is the notification.
- **Poll interval `2000ms` is a Phase 1 default.** Make it configurable via `DISPATCH_INTERVAL_MS` env var. Do not hardcode it in `DispatchLoop`.
- **`batchSize = 10` is a safe default.** If you are processing more than 10 tasks per 2s tick in Phase 1, something else is wrong.
- **Tomorrow (Day 09):** Linear workflow execution — the Orchestrator will define and run a simple step sequence (context → execute → verify) for each task.

---

*Prev: [Day 07 — Week 1 Integration Checkpoint](day-07.md) | Next: [Day 09 — Linear Workflow Execution](day-09.md)*
