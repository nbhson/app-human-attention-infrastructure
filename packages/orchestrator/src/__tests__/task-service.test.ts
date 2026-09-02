import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EventType, newProjectID, newTaskID, TaskStatus } from '@harness/domain';
import type { EventEnvelope, TaskID, TaskStatus as TaskState, TaskStateChangedPayload } from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';
import { projects, tasks, taskStateHistory } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import {
  IllegalTransitionError,
  MissingRationaleError,
  StateConflictError,
  TerminalStateError,
} from '../state-machine/errors.js';
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

const SCHEMA = 'harness_test_task_service';
const PROJECT = newProjectID();

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // Delete in FK order. Tables are plain `text` ids so drizle resolves them via
  // the connection's search_path (set to the isolated schema by createTestDb).
  await testDb.db.delete(taskStateHistory);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
  await testDb.db.insert(projects).values({ id: PROJECT, name: 'test', repo_path: '/tmp/test' });
});

function makeService(bus: IEventBus = new RecordingBus()): {
  service: TaskService;
  bus: RecordingBus;
} {
  const service = new TaskService(testDb.db, bus, new TaskStateMachine());
  return { service, bus: bus as RecordingBus };
}

/** Insert a task directly in `state` (bypassing the service) for setup. */
async function insertTask(state: TaskState, attemptNumber = 0): Promise<TaskID> {
  const id = newTaskID();
  await testDb.db.insert(tasks).values({
    id,
    project_id: PROJECT,
    title: `task-${state}`,
    state,
    attempt_number: attemptNumber,
    idempotency_key: `${id}:${attemptNumber}`,
  });
  return id;
}

describe('TaskService', () => {
  it('createTask inserts a PENDING row with a valid UUIDv7 id', async () => {
    const { service } = makeService();

    const task = await service.createTask({ projectId: PROJECT, title: 'hello' });

    expect(task.state).toBe(TaskStatus.Pending);
    expect(task.attemptNumber).toBe(0);
    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('transitionTask updates state, writes history, and publishes task.state_changed', async () => {
    const { service, bus } = makeService();
    const task = await service.createTask({ projectId: PROJECT, title: 'hello' });

    const updated = await service.transitionTask(task.id, TaskStatus.Queued, 'orchestrator');

    expect(updated.state).toBe(TaskStatus.Queued);

    const history = await service.getTaskHistory(task.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromState: TaskStatus.Pending,
      toState: TaskStatus.Queued,
      triggeredBy: 'orchestrator',
      attemptNumber: 0,
    });

    expect(bus.published).toHaveLength(1);
    const payload = bus.published[0]?.payload as TaskStateChangedPayload;
    expect(bus.published[0]?.event_type).toBe(EventType.TaskStateChanged);
    expect(payload).toMatchObject({
      task_id: task.id,
      from_state: TaskStatus.Pending,
      to_state: TaskStatus.Queued,
      triggered_by: 'orchestrator',
      attempt_number: 0,
    });
  });

  it('rejects an illegal transition with IllegalTransitionError listing legal targets', async () => {
    const { service } = makeService();
    const task = await service.createTask({ projectId: PROJECT, title: 'hello' });

    await expect(service.transitionTask(task.id, TaskStatus.Executing, 'agent_runtime')).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );

    await expect(service.transitionTask(task.id, TaskStatus.Executing, 'agent_runtime')).rejects.toThrow(
      /Legal targets from PENDING: QUEUED, CANCELLED/,
    );
  });

  it('rejects a transition from a terminal state with TerminalStateError', async () => {
    const { service } = makeService();
    const id = await insertTask(TaskStatus.Completed);

    await expect(service.transitionTask(id, TaskStatus.Queued, 'human')).rejects.toBeInstanceOf(TerminalStateError);
  });

  it('REWORK -> QUEUED increments attempt_number and regenerates the idempotency key', async () => {
    const { service } = makeService();
    const id = await insertTask(TaskStatus.Rework, 1);

    const updated = await service.transitionTask(id, TaskStatus.Queued, 'orchestrator');

    expect(updated.attemptNumber).toBe(2);
    expect(updated.idempotencyKey).toBe(`${id}:2`);
  });

  it('throws StateConflictError when the optimistic lock matches zero rows', async () => {
    const { service } = makeService();
    const id = await insertTask(TaskStatus.Pending);

    // Move the row out from under the caller, without going through the service.
    await testDb.db.update(tasks).set({ state: TaskStatus.Queued }).where(eq(tasks.id, id));

    await expect(
      service.transitionTask(id, TaskStatus.Queued, 'orchestrator', {
        expectedFrom: TaskStatus.Pending,
      }),
    ).rejects.toBeInstanceOf(StateConflictError);
  });

  it('requires a rationale for human transitions', async () => {
    const { service } = makeService();
    const id = await insertTask(TaskStatus.AwaitingReview);

    await expect(service.transitionTask(id, TaskStatus.Approved, 'human')).rejects.toBeInstanceOf(
      MissingRationaleError,
    );

    const updated = await service.transitionTask(id, TaskStatus.Approved, 'human', {
      rationale: 'looks correct',
    });
    expect(updated.state).toBe(TaskStatus.Approved);
  });

  it('getTaskHistory returns entries oldest-first', async () => {
    const { service } = makeService();
    const task = await service.createTask({ projectId: PROJECT, title: 'hello' });

    await service.transitionTask(task.id, TaskStatus.Queued, 'orchestrator');
    await service.transitionTask(task.id, TaskStatus.Executing, 'agent_runtime');

    const history = await service.getTaskHistory(task.id);
    expect(history.map((entry) => entry.fromState)).toEqual([TaskStatus.Pending, TaskStatus.Queued]);
  });

  it('rejects a duplicate idempotency key insert at the DB level', async () => {
    const values = {
      id: newTaskID(),
      project_id: PROJECT,
      title: 'dup',
      state: TaskStatus.Pending,
      idempotency_key: 'duplicate-key',
    };

    await testDb.db.insert(tasks).values(values);

    await expect(testDb.db.insert(tasks).values({ ...values, id: newTaskID() })).rejects.toThrow();
  });
});
