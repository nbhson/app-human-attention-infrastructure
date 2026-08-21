import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EventType, TaskStatus, newProjectID, newTaskID } from '@harness/domain';
import type { EventEnvelope, TaskID, TaskStatus as TaskState } from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';
import { projects, retryLog, tasks, taskStateHistory, taskStepLog } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { FailureClass } from '../retry/failure-class.js';
import { DEFAULT_RETRY_POLICY } from '../retry/retry-policy.js';
import type { RetryPolicyConfig } from '../retry/retry-policy.js';
import { TaskStateMachine } from '../state-machine/task-state-machine.js';
import { TaskService } from '../task-service.js';
import type { StepHandler } from '../workflow/step-handler.js';
import { LINEAR_WORKFLOW_V1, StepKind } from '../workflow/workflow-definition.js';
import type { WorkflowDefinition } from '../workflow/workflow-definition.js';
import { WorkflowRunner } from '../workflow/workflow-runner.js';

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

/** 1ms backoff so the default retry budgets run fast under real timers. */
const FAST_RETRY_POLICY: RetryPolicyConfig = {
  ...DEFAULT_RETRY_POLICY,
  baseDelayMs: 1,
  maxDelayMs: 1,
  jitterFactor: 0,
};

const SCHEMA = 'harness_test_workflow_runner';
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
  await testDb.db.delete(retryLog);
  await testDb.db.delete(taskStepLog);
  await testDb.db.delete(taskStateHistory);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
  await testDb.db.insert(projects).values({ id: PROJECT, name: 'test', repo_path: '/tmp/test' });
});

/** Insert a task already past dispatch, ready for the runner to execute. */
async function insertTask(state: TaskState = TaskStatus.Executing): Promise<TaskID> {
  const id = newTaskID();
  await testDb.db.insert(tasks).values({
    id,
    project_id: PROJECT,
    title: `task-${state}`,
    state,
    attempt_number: 0,
    max_attempts: 3,
    idempotency_key: `${id}:0`,
  });
  return id;
}

const okHandler: StepHandler = async () => ({ ok: true, output: {} });

function makeRunner(handlers: Map<StepKind, StepHandler>): WorkflowRunner {
  const service = new TaskService(testDb.db, new RecordingBus(), new TaskStateMachine());
  return new WorkflowRunner(testDb.db, service, handlers, FAST_RETRY_POLICY);
}

/** A registry that defaults every step to success, with per-step overrides. */
function handlers(
  overrides: Partial<Record<StepKind, StepHandler>> = {},
): Map<StepKind, StepHandler> {
  return new Map<StepKind, StepHandler>([
    [StepKind.COLLECT_CONTEXT, overrides.COLLECT_CONTEXT ?? okHandler],
    [StepKind.EXECUTE, overrides.EXECUTE ?? okHandler],
    [StepKind.VERIFY, overrides.VERIFY ?? okHandler],
  ]);
}

async function stepsFor(taskId: TaskID) {
  return testDb.db
    .select()
    .from(taskStepLog)
    .where(eq(taskStepLog.task_id, taskId))
    .orderBy(asc(taskStepLog.step_index));
}

async function taskState(taskId: TaskID): Promise<string | undefined> {
  const rows = await testDb.db.select().from(tasks).where(eq(tasks.id, taskId));
  return rows[0]?.state;
}

describe('WorkflowRunner', () => {
  it('executes all steps in order and records COMPLETED, leaving the task EXECUTING', async () => {
    const id = await insertTask();

    await makeRunner(handlers()).run(id, LINEAR_WORKFLOW_V1);

    const rows = await stepsFor(id);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.step_index)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.step_kind)).toEqual(['COLLECT_CONTEXT', 'EXECUTE', 'VERIFY']);
    expect(rows.map((r) => r.status)).toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED']);

    // Success path: the runner must NOT transition — the completion handler owns it.
    expect(await taskState(id)).toBe(TaskStatus.Executing);
  });

  it('writes a STARTED row before invoking the handler', async () => {
    const id = await insertTask();
    let sawStarted = false;

    const collectContext: StepHandler = async (ctx) => {
      const rows = await testDb.db
        .select()
        .from(taskStepLog)
        .where(and(eq(taskStepLog.task_id, ctx.taskId), eq(taskStepLog.step_index, ctx.stepIndex)));
      sawStarted = rows[0]?.status === 'STARTED';
      return { ok: true, output: {} };
    };

    await makeRunner(handlers({ COLLECT_CONTEXT: collectContext })).run(id, LINEAR_WORKFLOW_V1);

    expect(sawStarted).toBe(true);
  });

  it('a failing step 0 stops the workflow and escalates the task', async () => {
    const id = await insertTask();
    let executeRan = false;
    let verifyRan = false;

    const collectContext: StepHandler = async () => ({
      ok: false,
      error: 'context boom',
      failureClass: FailureClass.PERMANENT,
      retriable: false,
    });
    const execute: StepHandler = async () => {
      executeRan = true;
      return { ok: true, output: {} };
    };
    const verify: StepHandler = async () => {
      verifyRan = true;
      return { ok: true, output: {} };
    };

    await makeRunner(
      handlers({ COLLECT_CONTEXT: collectContext, EXECUTE: execute, VERIFY: verify }),
    ).run(id, LINEAR_WORKFLOW_V1);

    expect(executeRan).toBe(false);
    expect(verifyRan).toBe(false);

    const rows = await stepsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('FAILED');
    expect(rows[0]?.step_index).toBe(0);

    expect(await taskState(id)).toBe(TaskStatus.AwaitingHumanIntervention);
  });

  it('a failing step 1 records step 0 COMPLETED and stops before step 2', async () => {
    const id = await insertTask();
    let verifyRan = false;

    const execute: StepHandler = async () => ({
      ok: false,
      error: 'agent boom',
      failureClass: FailureClass.PERMANENT,
      retriable: false,
    });
    const verify: StepHandler = async () => {
      verifyRan = true;
      return { ok: true, output: {} };
    };

    await makeRunner(handlers({ EXECUTE: execute, VERIFY: verify })).run(id, LINEAR_WORKFLOW_V1);

    expect(verifyRan).toBe(false);

    const rows = await stepsFor(id);
    expect(rows.map((r) => r.status)).toEqual(['COMPLETED', 'FAILED']);

    expect(await taskState(id)).toBe(TaskStatus.AwaitingHumanIntervention);
  });

  it('a thrown handler exception is treated as a failed step', async () => {
    const id = await insertTask();

    const collectContext: StepHandler = async () => {
      throw new Error('kaboom');
    };

    await makeRunner(handlers({ COLLECT_CONTEXT: collectContext })).run(id, LINEAR_WORKFLOW_V1);

    const rows = await stepsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('FAILED');
    const output = rows[0]?.output as { error: string };
    expect(output.error).toBe('kaboom');

    // An unrecognised throw is classified PERMANENT — no retry, immediate escalation.
    expect(await taskState(id)).toBe(TaskStatus.AwaitingHumanIntervention);
  });

  it('a step that exceeds its timeout is TRANSIENT: retried, then escalates', async () => {
    const id = await insertTask();

    const slow: StepHandler = () => new Promise<never>(() => {}); // never resolves
    const workflow: WorkflowDefinition = {
      id: 'timeout-test',
      version: 1,
      steps: [{ kind: StepKind.EXECUTE, label: 'slow step', timeoutMs: 10 }],
    };

    await makeRunner(new Map<StepKind, StepHandler>([[StepKind.EXECUTE, slow]])).run(id, workflow);

    const rows = await stepsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('FAILED');
    const output = rows[0]?.output as {
      error: string;
      failureClass: string;
      retriable: boolean;
    };
    expect(output.error).toBe('STEP_TIMEOUT');
    expect(output.failureClass).toBe(FailureClass.TRANSIENT);

    // STEP_TIMEOUT is TRANSIENT, so the default budget retries it 3 times first.
    const retries = await testDb.db.select().from(retryLog).where(eq(retryLog.task_id, id));
    expect(retries).toHaveLength(3);

    expect(await taskState(id)).toBe(TaskStatus.AwaitingHumanIntervention);
  });

  it('LINEAR_WORKFLOW_V1 has exactly 3 steps in order COLLECT_CONTEXT → EXECUTE → VERIFY', () => {
    expect(LINEAR_WORKFLOW_V1.id).toBe('linear-v1');
    expect(LINEAR_WORKFLOW_V1.version).toBe(1);
    expect(LINEAR_WORKFLOW_V1.steps.map((s) => s.kind)).toEqual([
      StepKind.COLLECT_CONTEXT,
      StepKind.EXECUTE,
      StepKind.VERIFY,
    ]);
    expect(LINEAR_WORKFLOW_V1.steps).toHaveLength(3);
  });
});
