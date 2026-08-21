import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EventType, TaskStatus, newProjectID, newTaskID } from '@harness/domain';
import type { EventEnvelope, TaskID } from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';
import { projects, retryLog, tasks, taskStateHistory, taskStepLog } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { FailureClass } from '../retry/failure-class.js';
import { DEFAULT_RETRY_POLICY } from '../retry/retry-policy.js';
import type { RetryPolicyConfig } from '../retry/retry-policy.js';
import { TaskStateMachine } from '../state-machine/task-state-machine.js';
import { TaskService } from '../task-service.js';
import type { StepHandler } from '../workflow/step-handler.js';
import { StepKind } from '../workflow/workflow-definition.js';
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

/**
 * Same retry budgets as the default, but with a 1ms backoff so real-timer
 * sleeps run in single-digit milliseconds instead of seconds (day-10 §6).
 */
const FAST_RETRY_POLICY: RetryPolicyConfig = {
  ...DEFAULT_RETRY_POLICY,
  baseDelayMs: 1,
  maxDelayMs: 1,
  jitterFactor: 0,
};

const SCHEMA = 'harness_test_workflow_runner_retry';
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
async function insertTask(): Promise<TaskID> {
  const id = newTaskID();
  await testDb.db.insert(tasks).values({
    id,
    project_id: PROJECT,
    title: 'retry-target',
    state: TaskStatus.Executing,
    attempt_number: 0,
    max_attempts: 3,
    idempotency_key: `${id}:0`,
  });
  return id;
}

function makeRunner(
  handler: StepHandler,
  retryPolicy: RetryPolicyConfig = FAST_RETRY_POLICY,
): WorkflowRunner {
  const service = new TaskService(testDb.db, new RecordingBus(), new TaskStateMachine());
  return new WorkflowRunner(
    testDb.db,
    service,
    new Map<StepKind, StepHandler>([[StepKind.EXECUTE, handler]]),
    retryPolicy,
  );
}

/** A single-step workflow with no timeout (timeout is covered elsewhere). */
const SINGLE_STEP: WorkflowDefinition = {
  id: 'retry-test',
  version: 1,
  steps: [{ kind: StepKind.EXECUTE, label: 'execute', timeoutMs: 0 }],
};

async function retryRowsFor(taskId: TaskID) {
  return testDb.db
    .select()
    .from(retryLog)
    .where(eq(retryLog.task_id, taskId))
    .orderBy(asc(retryLog.attempt_number));
}

async function taskState(taskId: TaskID): Promise<string | undefined> {
  const rows = await testDb.db.select().from(tasks).where(eq(tasks.id, taskId));
  return rows[0]?.state;
}

describe('WorkflowRunner retry', () => {
  it('retries a TRANSIENT failure up to 3 times, then escalates', async () => {
    const id = await insertTask();
    let calls = 0;
    const handler: StepHandler = async () => {
      calls += 1;
      return {
        ok: false,
        error: 'ETIMEDOUT',
        failureClass: FailureClass.TRANSIENT,
        retriable: true,
      };
    };

    await makeRunner(handler).run(id, SINGLE_STEP);

    expect(calls).toBe(4); // initial + 3 retries
    expect(await taskState(id)).toBe(TaskStatus.AwaitingHumanIntervention);

    const retries = await retryRowsFor(id);
    expect(retries).toHaveLength(3);
    expect(retries.map((r) => r.attempt_number)).toEqual([1, 2, 3]);
    expect(retries.every((r) => r.failure_class === FailureClass.TRANSIENT)).toBe(true);
  });

  it('records exactly 3 retry_log rows after exhaustion', async () => {
    const id = await insertTask();
    const handler: StepHandler = async () => ({
      ok: false,
      error: 'ETIMEDOUT',
      failureClass: FailureClass.TRANSIENT,
      retriable: true,
    });

    await makeRunner(handler).run(id, SINGLE_STEP);

    expect(await retryRowsFor(id)).toHaveLength(3);
  });

  it('recovers on the second retry: task stays EXECUTING, 2 retries, 1 COMPLETED row', async () => {
    const id = await insertTask();
    let calls = 0;
    const handler: StepHandler = async () => {
      calls += 1;
      if (calls <= 2) {
        return {
          ok: false,
          error: 'ETIMEDOUT',
          failureClass: FailureClass.TRANSIENT,
          retriable: true,
        };
      }
      return { ok: true, output: { recovered: true } };
    };

    await makeRunner(handler).run(id, SINGLE_STEP);

    expect(calls).toBe(3);
    expect(await taskState(id)).toBe(TaskStatus.Executing);

    const retries = await retryRowsFor(id);
    expect(retries).toHaveLength(2);

    const stepRows = await testDb.db.select().from(taskStepLog).where(eq(taskStepLog.task_id, id));
    expect(stepRows).toHaveLength(1);
    expect(stepRows[0]?.status).toBe('COMPLETED');
    expect(stepRows[0]?.output).toEqual({ recovered: true });
  });

  it('never retries a PERMANENT failure', async () => {
    const id = await insertTask();
    let calls = 0;
    const handler: StepHandler = async () => {
      calls += 1;
      return { ok: false, error: '23505', failureClass: FailureClass.PERMANENT, retriable: false };
    };

    await makeRunner(handler).run(id, SINGLE_STEP);

    expect(calls).toBe(1);
    expect(await retryRowsFor(id)).toHaveLength(0);
    expect(await taskState(id)).toBe(TaskStatus.AwaitingHumanIntervention);
  });

  it('retries a RESOURCE failure up to 2 times', async () => {
    const id = await insertTask();
    const handler: StepHandler = async () => ({
      ok: false,
      error: 'LLM_RATE_LIMIT',
      failureClass: FailureClass.RESOURCE,
      retriable: true,
    });

    await makeRunner(handler).run(id, SINGLE_STEP);

    const retries = await retryRowsFor(id);
    expect(retries).toHaveLength(2);
    expect(retries.every((r) => r.failure_class === FailureClass.RESOURCE)).toBe(true);
    expect(await taskState(id)).toBe(TaskStatus.AwaitingHumanIntervention);
  });

  it('writes a positive integer delay_ms for every retry', async () => {
    const id = await insertTask();
    const handler: StepHandler = async () => ({
      ok: false,
      error: 'ETIMEDOUT',
      failureClass: FailureClass.TRANSIENT,
      retriable: true,
    });

    await makeRunner(handler).run(id, SINGLE_STEP);

    const retries = await retryRowsFor(id);
    expect(retries.length).toBeGreaterThan(0);
    for (const row of retries) {
      expect(Number.isInteger(row.delay_ms)).toBe(true);
      expect(row.delay_ms).toBeGreaterThan(0);
    }
  });
});
