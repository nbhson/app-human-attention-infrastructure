import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { agentRuns, artifacts, changes, projects, snapshots, tasks } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { InMemoryContentStore, streamToString } from '@harness/object-store';

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

describe('SnapshotStore object-store offload (day-21 §3.4)', () => {
  it('offloads content over the threshold to the object store (content_backend=object)', async () => {
    const seed = await seedRun(testDb.db);
    const { changeId } = await insertChange(testDb.db, seed);
    const objectStore = new InMemoryContentStore('object');
    const store = new SnapshotStore(objectStore, 10); // tiny threshold for the test
    const content = 'a'.repeat(64);

    const result = await store.save(testDb.db, changeId, content);

    const rows = await testDb.db.select().from(snapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBeNull();
    expect(rows[0]?.content_backend).toBe('object');
    expect(result.deduped).toBe(false);

    const roundTripped = await streamToString(
      await objectStore.get({ hash: sha256(content), backend: 'object' }),
    );
    expect(roundTripped).toBe(content);
  });

  it('keeps content at or under the threshold inline (content_backend=db)', async () => {
    const seed = await seedRun(testDb.db);
    const { changeId } = await insertChange(testDb.db, seed);
    const store = new SnapshotStore(new InMemoryContentStore('object'), 1024 * 1024);

    await store.save(testDb.db, changeId, 'small');

    const rows = await testDb.db.select().from(snapshots);
    expect(rows[0]?.content).toBe('small');
    expect(rows[0]?.content_backend).toBe('db');
  });

  it('dedupes identical large content without a second snapshot row', async () => {
    const seed = await seedRun(testDb.db);
    const { changeId } = await insertChange(testDb.db, seed);
    const store = new SnapshotStore(new InMemoryContentStore('object'), 10);
    const content = 'a'.repeat(128);

    const first = await store.save(testDb.db, changeId, content);
    const second = await store.save(testDb.db, changeId, content);

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(await testDb.db.select().from(snapshots)).toHaveLength(1);
  });
});
