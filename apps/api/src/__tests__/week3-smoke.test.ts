/**
 * Week 3 end-to-end smoke test (day-15 §5) — the Trust Pipeline's verification
 * leg across Verification Engine + Orchestrator + Tracker.
 *
 * Exercises the *real* stack with no mocks: the DI container, the in-process bus,
 * `TaskService`, the Day-14 tracker (`ArtifactCaptureSubscriber` → change capture),
 * the Day-15 `VerificationEngine` (`CompileCheck` over a real fixture worktree →
 * `verification.completed`), and the Day-14 `ChangeStatusSubscriber` (PENDING →
 * VERIFIED). The `Db` token is repointed at an isolated schema, and each project's
 * `repo_path` points at a compile fixture so the check really runs `tsc --noEmit`.
 */

import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { brand, EventType, newAgentRunID, newProjectID, TaskStatus } from '@harness/domain';
import type { ChangeID, TaskID } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import {
  agentRuns,
  artifacts,
  changes,
  eventLog,
  projects,
  retryLog,
  snapshots,
  taskStateHistory,
  taskStepLog,
  tasks,
  verificationCheckResults,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { Container, TOKENS } from '@harness/di';
import { LINEAR_WORKFLOW_V1, TaskService, WorkflowRunner } from '@harness/orchestrator';
import { VerificationEngine } from '@harness/verification-engine';

import { buildContainer } from '../bootstrap.js';

const SCHEMA = 'harness_test_week3';
const FIXTURES = fileURLToPath(
  new URL('../../../../packages/verification-engine/fixtures', import.meta.url),
);
const PASS_FIXTURE = `${FIXTURES}/compile-pass`;
const FAIL_FIXTURE = `${FIXTURES}/compile-fail`;

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
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  await db.delete(verificationCheckResults);
  await db.delete(verificationReports);
  await db.delete(taskStepLog);
  await db.delete(retryLog);
  await db.delete(snapshots);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(taskStateHistory);
  await db.delete(tasks);
  await db.delete(projects);
  await db.delete(eventLog);
});

/** Poll until `count()` reaches `expected` (subscriber DB writes are fire-and-forget). */
async function waitForCount(count: () => Promise<number>, expected: number): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    if ((await count()) >= expected) return;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${expected} row(s); saw ${await count()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Seed a task (module-level id) with `repoPath`, drive it to EXECUTING, and
 * simulate an agent writing a file (publishing `artifact.created`) so the tracker
 * captures a PENDING change. Returns the task + captured change ids.
 */
async function runningTaskWithChange(
  repoPath: string,
): Promise<{ taskId: TaskID; changeId: ChangeID }> {
  const taskService = container.resolve<TaskService>(TOKENS.TaskService);
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const bus = container.resolve<IEventBus>(TOKENS.EventBus);

  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'week3', repo_path: repoPath });

  const task = await taskService.createTask({ projectId, title: 'Week 3 smoke' });
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

  bus.publish(
    createEvent(EventType.ArtifactCreated, brand(runId, 'CorrelationID'), {
      agent_run_id: runId,
      file_path: 'src/index.ts',
      content_hash: 'x',
      size_bytes: 1,
      content: 'ok',
    }),
  );

  await waitForCount(async () => (await db.select().from(changes)).length, 1);
  const [change] = await db.select().from(changes);
  return { taskId: task.id, changeId: brand(change!.id, 'ChangeID') };
}

describe('Week 3 Smoke Test', () => {
  it('verify() flips a PENDING change to VERIFIED through the real subscriber chain', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);
    const { changeId } = await runningTaskWithChange(PASS_FIXTURE);

    const engine = container.resolve<VerificationEngine>(TOKENS.VerificationEngine);
    const report = await engine.verify(changeId);
    expect(report.overall).toBe('PASSED');

    await waitForCount(async () => {
      const rows = await db.select().from(changes);
      return rows.filter((c) => c.status === 'VERIFIED').length;
    }, 1);

    const reportRows = await db.select().from(verificationReports);
    expect(reportRows).toHaveLength(1);
    expect(reportRows[0]).toMatchObject({ change_id: changeId, overall: 'PASSED' });
  });

  it('VERIFY handler lands a failing change in REWORK', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);
    const taskService = container.resolve<TaskService>(TOKENS.TaskService);
    const { taskId } = await runningTaskWithChange(FAIL_FIXTURE);

    await container.resolve<WorkflowRunner>(TOKENS.WorkflowRunner).run(taskId, LINEAR_WORKFLOW_V1);

    const task = await taskService.getTask(taskId);
    expect(task?.state).toBe(TaskStatus.Rework);

    const reportRows = await db.select().from(verificationReports);
    expect(reportRows).toHaveLength(1);
    expect(reportRows[0]?.overall).toBe('FAILED');
  });

  it('VERIFY handler lands a passing change in AWAITING_REVIEW and VERIFIED', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);
    const taskService = container.resolve<TaskService>(TOKENS.TaskService);
    const { taskId, changeId } = await runningTaskWithChange(PASS_FIXTURE);

    await container.resolve<WorkflowRunner>(TOKENS.WorkflowRunner).run(taskId, LINEAR_WORKFLOW_V1);

    const task = await taskService.getTask(taskId);
    expect(task?.state).toBe(TaskStatus.AwaitingReview);

    // The engine's `verification.completed` also flipped the change to VERIFIED.
    await waitForCount(async () => {
      const rows = await db.select().from(changes);
      return rows.filter((c) => c.id === changeId && c.status === 'VERIFIED').length;
    }, 1);
  });
});
