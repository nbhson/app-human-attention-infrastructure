/**
 * `ReworkService` integration test (day-24 §5) — the reject path against the real
 * state machine: `REJECTED → REWORK` (carrying the rationale) or, at
 * `max_attempts`, `REJECTED → FAILED` + `task.failed`. It also proves the
 * `REWORK → QUEUED` attempt-increment discipline end-to-end via the Dispatcher.
 */

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  agentRuns,
  artifacts,
  decisions,
  dispatchLog,
  projects,
  reviewQueue,
  tasks,
  taskStateHistory,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { EventType, newProjectID, newTaskID, TaskStatus, uuidv7 } from '@harness/domain';
import type { EventEnvelope, TaskID } from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';
import { Dispatcher, TaskService, TaskStateMachine } from '@harness/orchestrator';

import { ReworkService } from '../services/rework.js';

/** A bus that records every published envelope (no dispatch needed here). */
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

const SCHEMA = 'harness_test_rework';

let testDb: TestDb;
let db: DrizzleDB;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await db.delete(decisions);
  await db.delete(reviewQueue);
  await db.delete(dispatchLog);
  await db.delete(agentRuns);
  await db.delete(artifacts);
  await db.delete(taskStateHistory);
  await db.delete(tasks);
  await db.delete(projects);
});

function taskService(bus: IEventBus): TaskService {
  return new TaskService(db, bus, new TaskStateMachine());
}

async function stateOf(taskId: TaskID): Promise<string | null> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId));
  return rows[0]?.state ?? null;
}

/** Seed a task sitting in REJECTED, with a prior rejection rationale on record. */
async function seedRejectedTask(
  attemptNumber: number,
  maxAttempts: number,
  rationale: string,
): Promise<TaskID> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'rework', repo_path: '/tmp/rework' });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'Rework me',
    state: TaskStatus.Rejected,
    attempt_number: attemptNumber,
    max_attempts: maxAttempts,
    idempotency_key: `${taskId}:${attemptNumber}`,
  });

  await db.insert(taskStateHistory).values({
    id: uuidv7(),
    task_id: taskId,
    from_state: TaskStatus.AwaitingReview,
    to_state: TaskStatus.Rejected,
    triggered_by: 'human',
    trigger_event_id: null,
    rationale,
    attempt_number: attemptNumber,
  });

  return taskId;
}

describe('ReworkService', () => {
  it('reject: REJECTED → REWORK carrying the rationale, then dispatcher → QUEUED attempt+1', async () => {
    const taskId = await seedRejectedTask(1, 3, 'needs more tests');
    const bus = new RecordingBus();
    const rework = new ReworkService(db, bus, taskService(bus));

    await rework.onRejected(taskId);

    expect(await stateOf(taskId)).toBe(TaskStatus.Rework);

    // The rationale is persisted on the REJECTED → REWORK history row (day-24 §6).
    const history = await db
      .select()
      .from(taskStateHistory)
      .where(
        and(eq(taskStateHistory.task_id, taskId), eq(taskStateHistory.to_state, TaskStatus.Rework)),
      );
    expect(history[0]?.rationale).toBe('needs more tests');

    // Dispatcher (day-08) is the only place REWORK → QUEUED bumps the attempt.
    const dispatcher = new Dispatcher(db, taskService(bus), bus);
    const result = await dispatcher.dispatchPending();
    expect(result.dispatched).toBe(1);

    const task = await taskService(bus).getTask(taskId);
    expect(task?.state).toBe(TaskStatus.Queued);
    expect(task?.attemptNumber).toBe(2);
  });

  it('reject at max_attempts: REJECTED → FAILED and publishes task.failed', async () => {
    const taskId = await seedRejectedTask(3, 3, 'needs more tests');
    const bus = new RecordingBus();
    const rework = new ReworkService(db, bus, taskService(bus));

    await rework.onRejected(taskId);

    expect(await stateOf(taskId)).toBe(TaskStatus.Failed);

    const failed = bus.published.find((event) => event.event_type === EventType.TaskFailed);
    expect(failed?.payload).toMatchObject({ task_id: taskId, reason: 'MAX_ATTEMPTS_EXHAUSTED' });
  });

  it('a duplicate REJECTED event is a no-op (guarded on the current state)', async () => {
    const taskId = await seedRejectedTask(1, 3, 'needs more tests');
    const bus = new RecordingBus();
    const rework = new ReworkService(db, bus, taskService(bus));

    await rework.onRejected(taskId);
    await rework.onRejected(taskId);

    expect(await stateOf(taskId)).toBe(TaskStatus.Rework);
  });
});
