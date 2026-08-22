/**
 * Day-28 C2 + C3 — double-claim and concurrent-transition protection.
 *
 * The RuntimePollLoop's `claimQueuedTask` uses `FOR UPDATE SKIP LOCKED`, but the
 * claim transaction commits *before* the runner transitions the task, so a second
 * poller can still see the task as QUEUED and try to run it. The real guard
 * against a double-run is `TaskService.transitionTask`'s optimistic lock
 * (`WHERE state = from`). These two tests prove that lock keeps the invariants:
 * exactly one `agent_runs` row per task, and exactly one state-history row per
 * transition — no duplicate, no double-run, no lost update.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import {
  agentRuns,
  dispatchLog,
  projects,
  taskStateHistory,
  tasks,
  trajectorySteps,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import {
  createTestDb,
  destroyTestDb,
  openTestDbConnection,
  type TestDb,
} from '@harness/db/test-utils';
import { brand, newProjectID, newTaskID, TaskStatus } from '@harness/domain';
import type { TaskID } from '@harness/domain';
import {
  AgentRunner,
  MockLLM,
  mockTextResponse,
  ToolAllowlist,
  ToolRegistry,
} from '@harness/agent-runtime';
import { InProcessEventBus } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { TaskService, TaskStateMachine } from '@harness/orchestrator';

const SCHEMA = 'harness_test_concurrency_runtime';

let testDb: TestDb; // connection A
let peer: TestDb; // connection B

function buildRunner(db: DrizzleDB, bus: IEventBus): AgentRunner {
  const taskService = new TaskService(db, bus, new TaskStateMachine());
  const llm = new MockLLM([mockTextResponse('done')]);
  const tools = new ToolRegistry(new ToolAllowlist(new Set<string>()), bus);
  // The completion handoff is an R4-safe seam; a no-op object (not a bare
  // function) models the bootstrap closure that starts the verification workflow.
  return new AgentRunner(db, bus, llm, tools, taskService, {
    runLinearWorkflow: async () => {},
  });
}

async function seedProject(db: DrizzleDB): Promise<string> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'p', repo_path: '/tmp/p' });
  return projectId;
}

async function seedTask(db: DrizzleDB, projectId: string, state: TaskStatus): Promise<TaskID> {
  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 't',
    state,
    idempotency_key: `${taskId}:0`,
  });
  return brand(taskId, 'TaskID');
}

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  peer = await openTestDbConnection(SCHEMA);
});

afterAll(async () => {
  await peer.sql.end();
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // Truncate in FK order (children before parents).
  await testDb.db.delete(trajectorySteps);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(taskStateHistory);
  await testDb.db.delete(dispatchLog);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
});

describe('Day-28 C2 — double poll', () => {
  it('two runners racing one QUEUED task produce exactly one agent_runs row', async () => {
    const projectId = await seedProject(testDb.db);
    const taskId = await seedTask(testDb.db, projectId, TaskStatus.Queued);

    const a = buildRunner(testDb.db, new InProcessEventBus());
    const b = buildRunner(peer.db, new InProcessEventBus());

    const results = await Promise.allSettled([a.runTask(taskId), b.runTask(taskId)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(Error);

    const runs = await testDb.db.select().from(agentRuns).where(eq(agentRuns.task_id, taskId));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('COMPLETED');
  });
});

describe('Day-28 C3 — concurrent state transition', () => {
  it('two QUEUED→EXECUTING transitions yield exactly one history row', async () => {
    const projectId = await seedProject(testDb.db);
    const taskId = await seedTask(testDb.db, projectId, TaskStatus.Queued);

    const a = new TaskService(testDb.db, new InProcessEventBus(), new TaskStateMachine());
    const b = new TaskService(peer.db, new InProcessEventBus(), new TaskStateMachine());

    const results = await Promise.allSettled([
      a.transitionTask(taskId, TaskStatus.Executing, 'agent_runtime'),
      b.transitionTask(taskId, TaskStatus.Executing, 'agent_runtime'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // Exactly one `QUEUED → EXECUTING` audit row: no duplicate transition record.
    const history = await testDb.db
      .select()
      .from(taskStateHistory)
      .where(
        and(
          eq(taskStateHistory.task_id, taskId),
          eq(taskStateHistory.to_state, TaskStatus.Executing),
        ),
      );
    expect(history).toHaveLength(1);
    expect(history[0]?.from_state).toBe(TaskStatus.Queued);

    const rows = await testDb.db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(rows[0]?.state).toBe(TaskStatus.Executing);
  });
});
