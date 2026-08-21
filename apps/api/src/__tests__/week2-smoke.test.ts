/**
 * Week 2 end-to-end smoke test (day-14 §5) — mirrors the Day-07 format, this time
 * across Orchestrator + Runtime + Tracker.
 *
 * Exercises the *real* stack with no mocks: the DI container, the in-process bus,
 * `TaskService`, and the Day-14 Artifact Tracker (`ArtifactCaptureSubscriber` →
 * `ArtifactTracker.capture` → `ChangeStatusSubscriber`). The `Db` token is
 * repointed at an isolated schema, so the run never touches the dev database.
 *
 * "Agent writes a file" is simulated by publishing `artifact.created` on the bus,
 * which is exactly what `write_file` does inside the ReAct loop (day-13 §3.3).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  brand,
  EventType,
  newAgentRunID,
  newProjectID,
  TaskStatus,
  VerificationStatus,
} from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import {
  agentRuns,
  artifacts,
  changes,
  eventLog,
  projects,
  snapshots,
  taskStateHistory,
  tasks,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { Container, TOKENS } from '@harness/di';
import { TaskService } from '@harness/orchestrator';

import { buildContainer } from '../bootstrap.js';

const SCHEMA = 'harness_test_week2';
const PROJECT = newProjectID();

let testDb: TestDb;
let container: Container;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);

  container = buildContainer();
  container.register(TOKENS.Db, () => testDb.db);

  // Resolve the subscribers eagerly so their handlers are attached to the bus
  // before any event fires (the api entrypoint does the same at boot).
  container.resolve(TOKENS.EventLogWriter);
  container.resolve(TOKENS.ArtifactCaptureSubscriber);
  container.resolve(TOKENS.ChangeStatusSubscriber);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await testDb.db.delete(snapshots);
  await testDb.db.delete(changes);
  await testDb.db.delete(artifacts);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(taskStateHistory);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
  await testDb.db.delete(eventLog);
  await testDb.db.insert(projects).values({ id: PROJECT, name: 'smoke', repo_path: '/tmp/smoke' });
});

/** Poll until `count()` reaches `expected` (subscriber DB writes are fire-and-forget). */
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

/** Create a task, drive it to EXECUTING, and return a real agent-run row for it. */
async function runningTaskWithAgentRun(): Promise<string> {
  const taskService = container.resolve<TaskService>(TOKENS.TaskService);
  const db = container.resolve<DrizzleDB>(TOKENS.Db);

  const task = await taskService.createTask({ projectId: PROJECT, title: 'Week 2 smoke' });
  await taskService.transitionTask(task.id, TaskStatus.Queued, 'orchestrator');
  await taskService.transitionTask(task.id, TaskStatus.Executing, 'agent_runtime');

  const runId = newAgentRunID();
  await db.insert(agentRuns).values({
    id: runId,
    task_id: task.id,
    attempt_number: 0,
    status: 'EXECUTING',
    max_steps: 10,
  });
  return runId;
}

describe('Week 2 Smoke Test', () => {
  it('create → execute → write_file → artifact captured as PENDING change + snapshot', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);
    const bus = container.resolve<IEventBus>(TOKENS.EventBus);
    const runId = await runningTaskWithAgentRun();

    // Simulate write_file publishing artifact.created.
    const content = 'console.log(1);\n';
    bus.publish(
      createEvent(EventType.ArtifactCreated, brand(runId, 'CorrelationID'), {
        agent_run_id: runId,
        file_path: 'src/main.ts',
        content_hash: 'irrelevant',
        size_bytes: content.length,
        content,
      }),
    );

    const countArtifacts = async (): Promise<number> => (await db.select().from(artifacts)).length;
    await waitForCount(countArtifacts, 1);

    const artifactRows = await db.select().from(artifacts);
    expect(artifactRows).toHaveLength(1);
    expect(artifactRows[0]).toMatchObject({
      project_id: PROJECT,
      file_path: 'src/main.ts',
    });

    const changeRows = await db.select().from(changes);
    expect(changeRows).toHaveLength(1);
    expect(changeRows[0]?.status).toBe('PENDING');
    expect(changeRows[0]?.agent_run_id).toBe(runId);

    const snapshotRows = await db.select().from(snapshots);
    expect(snapshotRows).toHaveLength(1);
    expect(snapshotRows[0]?.content).toBe(content);
  });

  it('verification.completed flips the captured change PENDING → VERIFIED', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);
    const bus = container.resolve<IEventBus>(TOKENS.EventBus);
    const runId = await runningTaskWithAgentRun();

    bus.publish(
      createEvent(EventType.ArtifactCreated, brand(runId, 'CorrelationID'), {
        agent_run_id: runId,
        file_path: 'src/verify.ts',
        content_hash: 'x',
        size_bytes: 1,
        content: 'ok',
      }),
    );

    await waitForCount(async () => (await db.select().from(changes)).length, 1);
    const changeRows = await db.select().from(changes);
    const changeId = changeRows[0]!.id;

    bus.publish(
      createEvent(EventType.VerificationCompleted, brand(changeId, 'CorrelationID'), {
        request_id: brand('req-1', 'VerificationRequestID'),
        change_id: brand(changeId, 'ChangeID'),
        result_id: brand('res-1', 'VerificationResultID'),
        status: VerificationStatus.Passed,
        check_summaries: ['compile ok'],
      }),
    );

    await waitForCount(async () => {
      const rows = await db.select().from(changes);
      return rows.filter((c) => c.status === 'VERIFIED').length;
    }, 1);
  });
});
