import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ArtifactStatus,
  EventType,
  newAgentRunID,
  newProjectID,
  newTaskID,
  TaskStatus,
} from '@harness/domain';
import type { AgentRunID, ArtifactCreatedPayload } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import { agentRuns, artifacts, projects, tasks } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { ArtifactCaptureSubscriber } from '../capture/artifact-capture-subscriber.js';

const SCHEMA = 'harness_test_artifact_capture';
const PROJECT = newProjectID();

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await testDb.db.delete(artifacts);
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
    title: 'artifact task',
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

describe('ArtifactCaptureSubscriber', () => {
  it('captures an artifact.created event into a DRAFT artifacts row', async () => {
    const runId = await insertRun();
    const subscriber = new ArtifactCaptureSubscriber(testDb.db);
    const payload: ArtifactCreatedPayload = {
      agent_run_id: runId,
      file_path: 'src/index.ts',
      content_hash: 'abc123',
      size_bytes: 13,
    };

    await subscriber.capture(payload);

    const rows = await testDb.db.select().from(artifacts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      project_id: PROJECT,
      file_path: 'src/index.ts',
      status: ArtifactStatus.Draft,
    });
  });

  it('subscribes a handler to artifact.created', () => {
    const bus = new InProcessEventBus();
    const subscriber = new ArtifactCaptureSubscriber(testDb.db);
    subscriber.subscribe(bus);

    expect(bus.subscriberCount(EventType.ArtifactCreated)).toBe(1);
  });

  it('drops an event for an unknown agent run without throwing', async () => {
    const subscriber = new ArtifactCaptureSubscriber(testDb.db);
    const payload: ArtifactCreatedPayload = {
      agent_run_id: newAgentRunID(),
      file_path: 'orphan.txt',
      content_hash: 'h',
      size_bytes: 1,
    };

    await expect(subscriber.capture(payload)).resolves.toBeUndefined();
    expect(await testDb.db.select().from(artifacts)).toHaveLength(0);
  });
});
