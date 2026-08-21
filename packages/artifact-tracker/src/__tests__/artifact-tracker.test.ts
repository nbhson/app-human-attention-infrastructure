import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ArtifactStatus, ChangeStatus, FileChangeType, newAgentRunID } from '@harness/domain';
import { agentRuns, artifacts, changes, projects, snapshots, tasks } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { ArtifactTracker } from '../artifact-tracker.js';
import { SnapshotStore, sha256 } from '../snapshot-store.js';
import { seedRun } from './helpers.js';

const SCHEMA = 'harness_test_artifact_tracker';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await testDb.db.delete(snapshots); // references changes
  await testDb.db.delete(changes); // references artifacts, agent_runs
  await testDb.db.delete(artifacts);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
});

function tracker(): ArtifactTracker {
  return new ArtifactTracker(testDb.db, new SnapshotStore());
}

describe('ArtifactTracker.capture', () => {
  it('captures a write into a DRAFT artifact + PENDING change + snapshot', async () => {
    const seed = await seedRun(testDb.db);
    const result = await tracker().capture({
      agentRunId: seed.runId,
      filePath: 'src/index.ts',
      content: 'hello',
    });

    expect(result).not.toBeNull();
    const { artifactId, changeId } = result!;

    const artifactRows = await testDb.db.select().from(artifacts);
    expect(artifactRows).toHaveLength(1);
    expect(artifactRows[0]).toMatchObject({
      id: artifactId,
      project_id: seed.projectId,
      file_path: 'src/index.ts',
      status: ArtifactStatus.Draft,
      current_change_id: changeId,
    });

    const changeRows = await testDb.db.select().from(changes);
    expect(changeRows).toHaveLength(1);
    expect(changeRows[0]).toMatchObject({
      id: changeId,
      artifact_id: artifactId,
      agent_run_id: seed.runId,
      change_type: FileChangeType.Created,
      status: ChangeStatus.Pending,
      content_hash: sha256('hello'),
    });

    const snapshotRows = await testDb.db.select().from(snapshots);
    expect(snapshotRows).toHaveLength(1);
    expect(snapshotRows[0]).toMatchObject({
      change_id: changeId,
      content: 'hello',
      content_hash: sha256('hello'),
    });
  });

  it('re-writes an existing path as MODIFIED on the same artifact', async () => {
    const seed = await seedRun(testDb.db);
    const service = tracker();

    const first = await service.capture({
      agentRunId: seed.runId,
      filePath: 'src/app.ts',
      content: 'v1',
    });
    const second = await service.capture({
      agentRunId: seed.runId,
      filePath: 'src/app.ts',
      content: 'v2',
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.artifactId).toBe(first!.artifactId);

    const artifactRows = await testDb.db.select().from(artifacts);
    expect(artifactRows).toHaveLength(1);
    expect(artifactRows[0]?.current_change_id).toBe(second!.changeId);

    const changeRows = await testDb.db.select().from(changes);
    expect(changeRows).toHaveLength(2);
    expect(changeRows.map((c) => c.change_type)).toEqual([
      FileChangeType.Created,
      FileChangeType.Modified,
    ]);
  });

  it('dedupes identical content across captures: one snapshot row', async () => {
    const seed = await seedRun(testDb.db);
    const service = tracker();

    await service.capture({ agentRunId: seed.runId, filePath: 'a.txt', content: 'same bytes' });
    await service.capture({ agentRunId: seed.runId, filePath: 'b.txt', content: 'same bytes' });

    expect(await testDb.db.select().from(artifacts)).toHaveLength(2);
    expect(await testDb.db.select().from(changes)).toHaveLength(2);
    expect(await testDb.db.select().from(snapshots)).toHaveLength(1);
  });

  it('drops a write from an unknown agent run (returns null, writes nothing)', async () => {
    const result = await tracker().capture({
      agentRunId: newAgentRunID(),
      filePath: 'orphan.txt',
      content: 'orphan',
    });

    expect(result).toBeNull();
    expect(await testDb.db.select().from(artifacts)).toHaveLength(0);
    expect(await testDb.db.select().from(changes)).toHaveLength(0);
    expect(await testDb.db.select().from(snapshots)).toHaveLength(0);
  });
});
