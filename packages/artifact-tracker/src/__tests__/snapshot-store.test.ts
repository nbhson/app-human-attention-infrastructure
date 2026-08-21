import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { agentRuns, artifacts, changes, projects, snapshots, tasks } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { SnapshotStore, sha256 } from '../snapshot-store.js';
import { insertChange, seedRun } from './helpers.js';

const SCHEMA = 'harness_test_snapshot_store';

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

describe('SnapshotStore', () => {
  it('saves content once and returns the snapshot id', async () => {
    const seed = await seedRun(testDb.db);
    const { changeId } = await insertChange(testDb.db, seed);
    const store = new SnapshotStore();

    const result = await store.save(testDb.db, changeId, 'hello world');

    expect(result.deduped).toBe(false);
    const rows = await testDb.db.select().from(snapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      change_id: changeId,
      content: 'hello world',
      content_hash: sha256('hello world'),
      generation: 1,
    });
  });

  it('dedupes identical content: second save returns the same, existing id', async () => {
    const seed = await seedRun(testDb.db);
    const { changeId } = await insertChange(testDb.db, seed);
    const store = new SnapshotStore();

    const first = await store.save(testDb.db, changeId, 'dup content');
    const second = await store.save(testDb.db, changeId, 'dup content');

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(await testDb.db.select().from(snapshots)).toHaveLength(1);
  });

  it('stores a snapshot per unique content, keyed by hash', async () => {
    const seed = await seedRun(testDb.db);
    const { changeId } = await insertChange(testDb.db, seed);
    const store = new SnapshotStore();

    await store.save(testDb.db, changeId, 'a');
    await store.save(testDb.db, changeId, 'b');

    expect(await testDb.db.select().from(snapshots)).toHaveLength(2);
  });
});
