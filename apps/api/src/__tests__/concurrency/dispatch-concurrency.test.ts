/**
 * Day-28 C1 — double dispatch.
 *
 * Two `Dispatcher`s, each on its own independent PostgreSQL connection, poll the
 * same queue concurrently. PostgreSQL is the concurrency primitive: `FOR UPDATE
 * SKIP LOCKED` (the claim) plus the unique `dispatch_log.idempotency_key` (the
 * reservation) together guarantee every PENDING task is QUEUED exactly once,
 * regardless of how the two pollers interleave between "claim committed" and
 * "transition applied".
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';

import { dispatchLog, projects, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import {
  createTestDb,
  destroyTestDb,
  openTestDbConnection,
  type TestDb,
} from '@harness/db/test-utils';
import { newProjectID, TaskStatus } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { Dispatcher, TaskService, TaskStateMachine } from '@harness/orchestrator';

const SCHEMA = 'harness_test_concurrency_dispatch';
const N_TASKS = 10;

let testDb: TestDb; // connection A
let peer: TestDb; // connection B (independent max:1 pool)

function buildDispatcher(db: DrizzleDB, bus: IEventBus): Dispatcher {
  const taskService = new TaskService(db, bus, new TaskStateMachine());
  return new Dispatcher(db, taskService, bus);
}

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  peer = await openTestDbConnection(SCHEMA);
});

afterAll(async () => {
  await peer.sql.end();
  await destroyTestDb(testDb, SCHEMA);
});

describe('Day-28 C1 — double dispatch', () => {
  it('10 PENDING tasks raced by two dispatchers are QUEUED exactly once each', async () => {
    const projectId = newProjectID();
    await testDb.db.insert(projects).values({ id: projectId, name: 'p', repo_path: '/tmp/p' });

    const seedTaskService = new TaskService(
      testDb.db,
      new InProcessEventBus(),
      new TaskStateMachine(),
    );
    const taskIds: string[] = [];
    for (let i = 0; i < N_TASKS; i++) {
      const task = await seedTaskService.createTask({ projectId, title: `task-${i}` });
      taskIds.push(task.id);
    }

    const a = buildDispatcher(testDb.db, new InProcessEventBus());
    const b = buildDispatcher(peer.db, new InProcessEventBus());

    const [ra, rb] = await Promise.all([a.dispatchPending(N_TASKS), b.dispatchPending(N_TASKS)]);

    // Every task is claimed and transitioned by exactly one poller. (A poller that
    // lost a claim to the other's committed reservation reports it as `skipped`.)
    expect(ra.dispatched + rb.dispatched).toBe(N_TASKS);
    expect(ra.failed + rb.failed).toBe(0);

    const queued = await testDb.db
      .select({ n: count() })
      .from(tasks)
      .where(eq(tasks.state, TaskStatus.Queued));
    expect(queued[0]?.n).toBe(N_TASKS);

    const pending = await testDb.db
      .select({ n: count() })
      .from(tasks)
      .where(eq(tasks.state, TaskStatus.Pending));
    expect(pending[0]?.n).toBe(0);

    // The idempotency log holds exactly one row per reserved task:attempt — the
    // unique constraint on `idempotency_key` is the second line of defense behind
    // SKIP LOCKED, and it must not have allowed any duplicate.
    const log = await testDb.db.select().from(dispatchLog);
    expect(log).toHaveLength(N_TASKS);
    const keys = new Set(log.map((row) => row.idempotency_key));
    expect(keys.size).toBe(N_TASKS);
    for (const taskId of taskIds) {
      expect(keys.has(`${taskId}:0`)).toBe(true);
    }
  });
});
