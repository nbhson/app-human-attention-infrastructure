import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ArtifactStatus, EventType, newAgentRunID } from '@harness/domain';
import type { ArtifactCreatedPayload } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import { agentRuns, artifacts, changes, projects, snapshots, tasks } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { ArtifactTracker } from '../artifact-tracker.js';
import { ArtifactCaptureSubscriber } from '../capture/artifact-capture-subscriber.js';
import { SnapshotStore, sha256 } from '../snapshot-store.js';
import { seedRun } from './helpers.js';

const SCHEMA = 'harness_test_artifact_capture';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await testDb.db.delete(snapshots);
  await testDb.db.delete(changes);
  await testDb.db.delete(artifacts);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
});

function subscriber(): ArtifactCaptureSubscriber {
  return new ArtifactCaptureSubscriber(new ArtifactTracker(testDb.db, new SnapshotStore()));
}

describe('ArtifactCaptureSubscriber', () => {
  it('captures an artifact.created event into DRAFT artifact + change + snapshot', async () => {
    const seed = await seedRun(testDb.db);
    const payload: ArtifactCreatedPayload = {
      agent_run_id: seed.runId,
      file_path: 'src/index.ts',
      content_hash: sha256('hello'),
      size_bytes: 5,
      content: 'hello',
    };

    await subscriber().capture(payload);

    const artifactRows = await testDb.db.select().from(artifacts);
    expect(artifactRows).toHaveLength(1);
    expect(artifactRows[0]).toMatchObject({
      project_id: seed.projectId,
      file_path: 'src/index.ts',
      status: ArtifactStatus.Draft,
    });
    expect(await testDb.db.select().from(changes)).toHaveLength(1);
    expect(await testDb.db.select().from(snapshots)).toHaveLength(1);
  });

  it('subscribes a handler to artifact.created', () => {
    const bus = new InProcessEventBus();
    subscriber().subscribe(bus);

    expect(bus.subscriberCount(EventType.ArtifactCreated)).toBe(1);
  });

  it('drops an event for an unknown agent run without throwing', async () => {
    const payload: ArtifactCreatedPayload = {
      agent_run_id: newAgentRunID(),
      file_path: 'orphan.txt',
      content_hash: 'h',
      size_bytes: 1,
      content: 'x',
    };

    await expect(subscriber().capture(payload)).resolves.toBeUndefined();
    expect(await testDb.db.select().from(artifacts)).toHaveLength(0);
    expect(await testDb.db.select().from(changes)).toHaveLength(0);
    expect(await testDb.db.select().from(snapshots)).toHaveLength(0);
  });
});
