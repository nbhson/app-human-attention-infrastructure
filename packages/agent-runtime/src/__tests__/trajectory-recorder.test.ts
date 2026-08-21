import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newAgentRunID, newProjectID, newTaskID, TaskStatus } from '@harness/domain';
import type { AgentRunID } from '@harness/domain';
import { agentRuns, projects, tasks, trajectorySteps } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import type { ReActStep } from '../react/react-loop.js';
import { TrajectoryRecorder } from '../trajectory/trajectory-recorder.js';

const SCHEMA = 'harness_test_trajectory';
const PROJECT = newProjectID();

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await testDb.db.delete(trajectorySteps);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
  await testDb.db.insert(projects).values({ id: PROJECT, name: 'test', repo_path: '/tmp/test' });
});

async function insertRun(): Promise<AgentRunID> {
  const taskId = newTaskID();
  await testDb.db.insert(tasks).values({
    id: taskId,
    project_id: PROJECT,
    title: 'trajectory task',
    state: TaskStatus.Executing,
    attempt_number: 0,
    idempotency_key: `${taskId}:0`,
  });
  const runId = newAgentRunID();
  await testDb.db.insert(agentRuns).values({
    id: runId,
    task_id: taskId,
    attempt_number: 0,
    status: 'EXECUTING',
    max_steps: 10,
  });
  return runId;
}

describe('TrajectoryRecorder', () => {
  it('records a step with a tool call, storing tool_input as jsonb', async () => {
    const runId = await insertRun();
    const recorder = new TrajectoryRecorder(testDb.db);

    const step: ReActStep = {
      stepNumber: 1,
      thought: 'I will read the file',
      toolCall: { id: 'c1', name: 'read_file', input: { path: 'a.txt' } },
      observation: 'the content',
    };
    await recorder.record(runId, step);

    const rows = await testDb.db
      .select()
      .from(trajectorySteps)
      .where(eq(trajectorySteps.agent_run_id, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agent_run_id: runId,
      step_number: 1,
      thought: 'I will read the file',
      tool_name: 'read_file',
      observation: 'the content',
    });
    expect(rows[0]?.tool_input).toEqual({ path: 'a.txt' });
  });

  it('records a final-answer step (no tool call) with nullable fields as null', async () => {
    const runId = await insertRun();
    const recorder = new TrajectoryRecorder(testDb.db);

    await recorder.record(runId, { stepNumber: 2, thought: 'done' });

    const rows = await testDb.db
      .select()
      .from(trajectorySteps)
      .where(eq(trajectorySteps.agent_run_id, runId));
    expect(rows[0]).toMatchObject({
      step_number: 2,
      thought: 'done',
      tool_name: null,
      tool_input: null,
      observation: null,
    });
  });
});
