/**
 * Week 1 end-to-end smoke test (day-07 §3.1).
 *
 * Exercises the *real* Week 1 stack with no mocks: the DI container, the
 * in-process event bus, `TaskService` + `TaskStateMachine`, and `EventLogWriter`
 * persisting into `event_log`. The only substitution is the `Db` token, which is
 * pointed at an isolated schema so the run never touches the dev database and
 * tears itself down completely.
 */

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { brand, EventType, newProjectID, newTaskID, TaskStatus } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import { eventLog, EventLogWriter, projects, tasks, taskStateHistory } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { Container, TOKENS } from '@harness/di';
import { IllegalTransitionError, TaskService } from '@harness/orchestrator';

import { buildContainer } from '../bootstrap.js';

const SCHEMA = 'harness_test_week1';
const PROJECT = newProjectID();

let testDb: TestDb;
let container: Container;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);

  // Build the real graph, then repoint `Db` at the isolated schema. The default
  // factory reads `DATABASE_URL` lazily and is never run after this override.
  container = buildContainer();
  container.register(TOKENS.Db, () => testDb.db);

  // Resolve eagerly so EventLogWriter subscribes to the bus *before* any task
  // transition fires an event (the api entrypoint does the same at boot).
  container.resolve(TOKENS.EventLogWriter);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // Reset the tables this test touches, in FK order, then seed one project.
  await testDb.db.delete(taskStateHistory); // references tasks
  await testDb.db.delete(tasks); // references projects
  await testDb.db.delete(projects);
  await testDb.db.delete(eventLog);
  await testDb.db.insert(projects).values({ id: PROJECT, name: 'smoke', repo_path: '/tmp/smoke' });
});

/** Poll until `count()` reaches `expected`, because `EventLogWriter` is fire-and-forget. */
async function waitForCount(count: () => Promise<number>, expected: number): Promise<void> {
  const deadline = Date.now() + 3000;
  for (;;) {
    if ((await count()) >= expected) return;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${expected} row(s); saw ${await count()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('Week 1 Smoke Test', () => {
  it('task lifecycle: create → queue → execute → verify → review → approve → complete', async () => {
    const taskService = container.resolve<TaskService>(TOKENS.TaskService);
    const db = container.resolve<DrizzleDB>(TOKENS.Db);

    // 1. Create.
    const task = await taskService.createTask({ projectId: PROJECT, title: 'Smoke test task' });
    expect(task.state).toBe(TaskStatus.Pending);

    // 2. Walk the full happy path.
    await taskService.transitionTask(task.id, TaskStatus.Queued, 'orchestrator');
    await taskService.transitionTask(task.id, TaskStatus.Executing, 'agent_runtime');
    await taskService.transitionTask(task.id, TaskStatus.Verifying, 'agent_runtime');
    await taskService.transitionTask(task.id, TaskStatus.AwaitingReview, 'verification_engine');
    await taskService.transitionTask(task.id, TaskStatus.Approved, 'human', { rationale: 'LGTM' });
    await taskService.transitionTask(task.id, TaskStatus.Completed, 'orchestrator');

    // 3. Final state.
    const final = await taskService.getTask(task.id);
    expect(final?.state).toBe(TaskStatus.Completed);

    // 4. Audit trail: 6 transitions (create is not a transition).
    const history = await taskService.getTaskHistory(task.id);
    expect(history).toHaveLength(6);

    // 5. event_log: 6 `task.state_changed` rows for this correlation id.
    const countStateChanged = async (): Promise<number> => {
      const rows = await db
        .select()
        .from(eventLog)
        .where(
          and(
            eq(eventLog.correlation_id, task.id),
            eq(eventLog.event_type, EventType.TaskStateChanged),
          ),
        );
      return rows.length;
    };
    await waitForCount(countStateChanged, 6);
  });

  it('illegal transition is rejected with a descriptive error', async () => {
    const taskService = container.resolve<TaskService>(TOKENS.TaskService);
    const task = await taskService.createTask({ projectId: PROJECT, title: 'Illegal test' });

    await expect(
      taskService.transitionTask(task.id, TaskStatus.Executing, 'orchestrator'),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('duplicate event_id in event_log is silently ignored (idempotency)', async () => {
    const writer = container.resolve<EventLogWriter>(TOKENS.EventLogWriter);
    const db = container.resolve<DrizzleDB>(TOKENS.Db);

    const taskId = newTaskID();
    const event = createEvent(EventType.TaskStateChanged, brand(taskId, 'CorrelationID'), {
      task_id: taskId,
      from_state: TaskStatus.Queued,
      to_state: TaskStatus.Executing,
      triggered_by: 'agent_runtime',
      attempt_number: 1,
    });

    await writer.write(event);
    await writer.write(event); // duplicate must be a silent no-op

    const rows = await db.select().from(eventLog).where(eq(eventLog.event_id, event.event_id));
    expect(rows).toHaveLength(1);
  });
});
