# @harness/orchestrator — Task / Work Orchestrator

## Trạng thái hiện tại

Stubs: `src/index.ts` chỉ export string `'orchestrator'`. Chưa có implementation.

---

## Mục đích

"Bộ não" của hệ thống — điều phối lifecycle của Task, quản lý workflow DAG, dispatch task đến Agent Runtime, xử lý retry/failure.

---

## Công việc cần làm

### Day 06 — State Machine

12 canonical states theo Spec 2 §3:

```
PENDING → QUEUED → EXECUTING → VERIFYING → AWAITING_REVIEW
                                          ↓         ↓
                                      APPROVED   REJECTED
                                          ↓         ↓
                                      COMPLETED  REWORK → QUEUED
                                                      ↓
                                            AWAITING_HUMAN_INTERVENTION
```

```typescript
// src/state-machine.ts
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  const transitions: Record<TaskStatus, TaskStatus[]> = {
    PENDING:        ['QUEUED'],
    QUEUED:         ['EXECUTING'],
    EXECUTING:      ['VERIFYING', 'FAILED', 'AWAITING_HUMAN_INTERVENTION'],
    VERIFYING:      ['AWAITING_REVIEW', 'FAILED'],
    AWAITING_REVIEW:['APPROVED', 'REJECTED'],
    APPROVED:       ['COMPLETED'],
    REJECTED:       ['REWORK'],
    REWORK:         ['QUEUED'],
    COMPLETED:      [],
    FAILED:         ['AWAITING_HUMAN_INTERVENTION'],
    AWAITING_HUMAN_INTERVENTION: ['QUEUED', 'CANCELLED'],
    CANCELLED:      [],
  };
  return transitions[from]?.includes(to) ?? false;
}

export async function transitionTask(
  db: Db,
  taskId: TaskID,
  newStatus: TaskStatus,
  expectedStatus: TaskStatus,
): Promise<void> {
  const result = await db.update(tasks)
    .set({ state: newStatus, updated_at: new Date() })
    .where(eq(tasks.id, taskId))
    .andWhere(eq(tasks.state, expectedStatus));

  if (result.count === 0n) {
    throw new StateConflictError(taskId, expectedStatus, newStatus);
  }
}
```

**Optimistic locking**: `UPDATE ... WHERE id = ? AND state = ?` → throw `StateConflictError` nếu conflict.

### Day 08 — Dispatcher & Worker

**Dispatcher** (pull-based):

```typescript
// src/dispatcher.ts
export class Dispatcher {
  async dispatchBatch(batchSize = 10): Promise<TaskID[]> {
    // SELECT ... FOR UPDATE SKIP LOCKED
    const tasks = await db.select()
      .from(tasksTable)
      .where(or(
        eq(tasksTable.state, 'PENDING'),
        and(eq(tasksTable.state, 'REWORK'), lt(tasksTable.attempt_number, tasksTable.max_attempts))
      ))
      .orderBy(asc(tasksTable.created_at))
      .for('update', 'skip locked')
      .limit(batchSize);

    for (const task of tasks) {
      await transitionTask(this.db, task.id, 'QUEUED', task.state);
      this.bus.publish({ type: EVENT_TYPES.TASK_STATE_CHANGED, /* ... */ });
    }
    return tasks.map(t => t.id);
  }
}
```

**Worker** (single worker Phase 1):

```typescript
// src/worker.ts
export class Worker {
  async pollAndExecute(): Promise<void> {
    const task = await this.db.select().from(tasksTable)
      .where(eq(tasksTable.state, 'QUEUED'))
      .limit(1)
      .for('update', 'skip locked');

    if (!task) return;

    await transitionTask(this.db, task.id, 'EXECUTING', 'QUEUED');
    this.bus.publish({ type: EVENT_TYPES.TASK_STATE_CHANGED, payload: { taskId: task.id, newState: 'EXECUTING' } });
    // Agent Runtime will pick up via event subscription
  }
}
```

### Day 09 — Linear Workflow

```typescript
// src/workflow-runner.ts
export class WorkflowRunner {
  async runLinear(tasks: Task[]): Promise<void> {
    for (const task of tasks) {
      await this.dispatchAndAwait(task);
    }
  }
}
```

### Day 10 — Retry & Idempotency

```typescript
// src/retry-handler.ts
export class RetryHandler {
  async handleFailure(task: Task): Promise<void> {
    const newAttempt = task.attemptNumber + 1;
    if (newAttempt >= task.maxAttempts) {
      await transitionTask(this.db, task.id, 'AWAITING_HUMAN_INTERVENTION', 'EXECUTING');
    } else {
      await transitionTask(this.db, task.id, 'REWORK', 'FAILED');
      await this.db.update(tasksTable)
        .set({ attemptNumber: newAttempt })
        .where(eq(tasksTable.id, task.id));
    }
  }
}

// Idempotency key = task_id:attempt_number
// dispatch_log table để track đã dispatch chưa
```

### Day 24 — Decision Flow

```typescript
// On APPROVE: trigger merge → update Change status
// On REJECT: trigger rework → REWORK → QUEUED
```

---

## Dependency rule

```
packages/orchestrator → import @harness/domain, @harness/event-bus, @harness/db
                      → KHÔNG import các engine packages khác
```

---

## Files cần tạo

```
src/
├── index.ts
├── state-machine.ts        # 12-state transition logic + guards
├── dispatcher.ts           # Poll queue → claim tasks
├── worker.ts               # Pull QUEUED tasks → trigger execution
├── workflow-runner.ts      # Linear / DAG workflow execution
├── retry-handler.ts        # Retry policy, max_attempts
├── idempotency.ts          # Dispatch log + idempotency key
└── __tests__/
    ├── state-machine.test.ts
    ├── dispatcher.test.ts
    └── retry-handler.test.ts
```
