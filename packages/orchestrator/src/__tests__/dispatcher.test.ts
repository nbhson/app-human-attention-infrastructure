import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EventType, newProjectID, newTaskID, TaskStatus } from '@harness/domain';
import type {
  EventEnvelope,
  TaskID,
  TaskStatus as TaskState,
  TaskStateChangedPayload,
} from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';
import { dispatchLog, projects, tasks, taskStateHistory } from '@harness/db';
import {
  createTestDb,
  destroyTestDb,
  openTestDbConnection,
  type TestDb,
} from '@harness/db/test-utils';

import { Dispatcher } from '../dispatch/dispatcher.js';
import { TaskStateMachine } from '../state-machine/task-state-machine.js';
import { TaskService } from '../task-service.js';

/** A bus that records every published envelope, for spy assertions. */
class RecordingBus implements IEventBus {
  readonly published: EventEnvelope[] = [];

  publish<T>(event: EventEnvelope<T>): void {
    this.published.push(event);
  }

  subscribe<T>(_eventType: EventType, _handler: EventHandler<T>): UnsubscribeFn {
    void _eventType;
    void _handler;
    return () => {};
  }
}

const SCHEMA = 'harness_test_dispatcher';
const PROJECT = newProjectID();

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // Delete in FK order, then seed one project.
  await testDb.db.delete(dispatchLog);
  await testDb.db.delete(taskStateHistory);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
  await testDb.db.insert(projects).values({ id: PROJECT, name: 'test', repo_path: '/tmp/test' });
});

function makeDispatcher(bus: IEventBus = new RecordingBus()): {
  dispatcher: Dispatcher;
  service: TaskService;
  bus: RecordingBus;
} {
  const service = new TaskService(testDb.db, bus, new TaskStateMachine());
  return { dispatcher: new Dispatcher(testDb.db, service), service, bus: bus as RecordingBus };
}

/** Insert a task directly in `state` (bypassing the service) for setup. */
async function insertTask(state: TaskState, attemptNumber = 0, maxAttempts = 3): Promise<TaskID> {
  const id = newTaskID();
  await testDb.db.insert(tasks).values({
    id,
    project_id: PROJECT,
    title: `task-${state}`,
    state,
    attempt_number: attemptNumber,
    max_attempts: maxAttempts,
    idempotency_key: `${id}:${attemptNumber}`,
  });
  return id;
}

async function countByState(state: TaskState): Promise<number> {
  const rows = await testDb.db.select().from(tasks).where(eq(tasks.state, state));
  return rows.length;
}

describe('Dispatcher', () => {
  it('dispatchPending transitions a PENDING task to QUEUED and inserts a dispatch_log row', async () => {
    const { dispatcher } = makeDispatcher();
    const id = await insertTask(TaskStatus.Pending);

    const result = await dispatcher.dispatchPending();

    expect(result).toEqual({ dispatched: 1, skipped: 0, failed: 0 });
    expect(await countByState(TaskStatus.Queued)).toBe(1);

    const rows = await testDb.db.select().from(dispatchLog).where(eq(dispatchLog.task_id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotency_key).toBe(`${id}:0`);
  });

  it('publishes task.state_changed with from=PENDING, to=QUEUED, triggered_by=orchestrator', async () => {
    const { dispatcher, bus } = makeDispatcher();
    const id = await insertTask(TaskStatus.Pending);

    await dispatcher.dispatchPending();

    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.event_type).toBe(EventType.TaskStateChanged);
    const payload = bus.published[0]?.payload as TaskStateChangedPayload;
    expect(payload).toMatchObject({
      task_id: id,
      from_state: TaskStatus.Pending,
      to_state: TaskStatus.Queued,
      triggered_by: 'orchestrator',
      attempt_number: 0,
    });
  });

  it('skips an already-dispatched task (idempotency)', async () => {
    const { dispatcher } = makeDispatcher();
    const id = await insertTask(TaskStatus.Pending);

    // Simulate a prior (or concurrent) dispatch that already logged this attempt.
    await testDb.db.insert(dispatchLog).values({
      id: newTaskID(),
      task_id: id,
      attempt_number: 0,
      idempotency_key: `${id}:0`,
      dispatched_at: new Date(),
    });

    const result = await dispatcher.dispatchPending();

    expect(result).toEqual({ dispatched: 0, skipped: 1, failed: 0 });
    // The task must remain PENDING — the reservation was already taken.
    expect(await countByState(TaskStatus.Pending)).toBe(1);
    const rows = await testDb.db.select().from(dispatchLog).where(eq(dispatchLog.task_id, id));
    expect(rows).toHaveLength(1);
  });

  it('skips tasks that are not PENDING or REWORK', async () => {
    const { dispatcher } = makeDispatcher();
    await insertTask(TaskStatus.Queued);
    await insertTask(TaskStatus.Executing);
    await insertTask(TaskStatus.Completed);
    await insertTask(TaskStatus.Cancelled);

    const result = await dispatcher.dispatchPending();

    expect(result).toEqual({ dispatched: 0, skipped: 0, failed: 0 });
    expect(await countByState(TaskStatus.Queued)).toBe(1); // the seeded QUEUED task
    expect(await countByState(TaskStatus.Executing)).toBe(1);
    expect(await countByState(TaskStatus.Completed)).toBe(1);
    expect(await countByState(TaskStatus.Cancelled)).toBe(1);
  });

  it('transitions a REWORK task to QUEUED when attempt_number < max_attempts', async () => {
    const { dispatcher } = makeDispatcher();
    const id = await insertTask(TaskStatus.Rework, 2, 3);

    await dispatcher.dispatchPending();

    const row = await testDb.db.select().from(tasks).where(eq(tasks.id, id));
    expect(row[0]?.state).toBe(TaskStatus.Queued);
    expect(row[0]?.attempt_number).toBe(3); // requeue bumps the attempt
  });

  it('transitions a REWORK task to FAILED when attempt_number >= max_attempts', async () => {
    const { dispatcher } = makeDispatcher();
    const id = await insertTask(TaskStatus.Rework, 3, 3);

    const result = await dispatcher.dispatchPending();

    expect(result).toEqual({ dispatched: 0, skipped: 0, failed: 1 });
    const row = await testDb.db.select().from(tasks).where(eq(tasks.id, id));
    expect(row[0]?.state).toBe(TaskStatus.Failed);
  });

  it('respects the batchSize limit', async () => {
    const { dispatcher } = makeDispatcher();
    await insertTask(TaskStatus.Pending);
    await insertTask(TaskStatus.Pending);
    await insertTask(TaskStatus.Pending);

    const result = await dispatcher.dispatchPending(2);

    expect(result).toEqual({ dispatched: 2, skipped: 0, failed: 0 });
    expect(await countByState(TaskStatus.Queued)).toBe(2);
    expect(await countByState(TaskStatus.Pending)).toBe(1);
  });

  it('does not double-dispatch the same task under concurrent polling (SKIP LOCKED)', async () => {
    const id = await insertTask(TaskStatus.Pending);
    const { dispatcher } = makeDispatcher();

    // A second, independent connection on the same schema so the two polls run in
    // genuinely separate transactions and contend on the row lock.
    const second = await openTestDbConnection(SCHEMA);
    try {
      const secondService = new TaskService(second.db, new RecordingBus(), new TaskStateMachine());
      const secondDispatcher = new Dispatcher(second.db, secondService);

      const [r1, r2] = await Promise.all([
        dispatcher.dispatchPending(),
        secondDispatcher.dispatchPending(),
      ]);

      expect(r1.dispatched + r2.dispatched).toBe(1);

      const row = await testDb.db.select().from(tasks).where(eq(tasks.id, id));
      expect(row[0]?.state).toBe(TaskStatus.Queued);

      const logRows = await testDb.db.select().from(dispatchLog).where(eq(dispatchLog.task_id, id));
      expect(logRows).toHaveLength(1);

      const historyRows = await testDb.db
        .select()
        .from(taskStateHistory)
        .where(eq(taskStateHistory.task_id, id));
      expect(historyRows).toHaveLength(1);
    } finally {
      await second.sql.end();
    }
  });
});
