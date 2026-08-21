import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ArtifactStatus,
  ChangeStatus,
  FileChangeType,
  newArtifactID,
  newChangeID,
  newSnapshotID,
} from '@harness/domain';
import type { ArtifactID, ChangeID } from '@harness/domain';
import { artifacts, changes, snapshots } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { DiffEngine } from '../diff-engine.js';
import { sha256 } from '../snapshot-store.js';
import { seedRun } from './helpers.js';
import type { SeedRun } from './helpers.js';

const SCHEMA = 'harness_test_diff_engine';

let testDb: TestDb;
let db: DrizzleDB;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

async function createArtifact(db: DrizzleDB, seed: SeedRun, filePath: string): Promise<ArtifactID> {
  const artifactId = newArtifactID();
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: seed.projectId,
    file_path: filePath,
    status: ArtifactStatus.Draft,
  });
  return artifactId;
}

/** Append a change (with its snapshot) to `artifactId` at an explicit timestamp. */
async function appendChange(
  db: DrizzleDB,
  seed: SeedRun,
  artifactId: ArtifactID,
  content: string,
  changeType: FileChangeType,
  createdAt: Date,
): Promise<ChangeID> {
  const changeId = newChangeID();
  const hash = sha256(content);
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: seed.runId,
    change_type: changeType,
    status: ChangeStatus.Pending,
    content_hash: hash,
    diff_summary: `${changeType} snapshot`,
    created_at: createdAt,
  });
  await db.insert(snapshots).values({
    id: newSnapshotID(),
    change_id: changeId,
    content_hash: hash,
    content,
    generation: 1,
  });
  return changeId;
}

describe('DiffEngine', () => {
  it('diffs a modified file with correct hunks and line counts', async () => {
    const seed = await seedRun(db, 'diff-modified');
    const artifactId = await createArtifact(db, seed, 'src/app.ts');
    await appendChange(
      db,
      seed,
      artifactId,
      'line1\nline2\nline3\n',
      FileChangeType.Created,
      new Date('2026-01-01T00:00:00Z'),
    );
    const changeId = await appendChange(
      db,
      seed,
      artifactId,
      'line1\nline2-changed\nline3\nline4\n',
      FileChangeType.Modified,
      new Date('2026-01-02T00:00:00Z'),
    );

    const diffs = await new DiffEngine(db).diffChange(changeId);

    expect(diffs).toHaveLength(1);
    const diff = diffs[0]!;
    expect(diff.path).toBe('src/app.ts');
    expect(diff.isNewFile).toBe(false);
    expect(diff.addedLines).toBe(2);
    expect(diff.removedLines).toBe(1);
    expect(diff.hunks).toContain('@@');
    expect(diff.hunks).toContain('-line2');
    expect(diff.hunks).toContain('+line2-changed');
    expect(diff.hunks).toContain('+line4');
  });

  it('reports isNewFile for a created file with no prior snapshot', async () => {
    const seed = await seedRun(db, 'diff-new-file');
    const artifactId = await createArtifact(db, seed, 'src/new.ts');
    const changeId = await appendChange(
      db,
      seed,
      artifactId,
      'line1\nline2\n',
      FileChangeType.Created,
      new Date('2026-01-01T00:00:00Z'),
    );

    const diffs = await new DiffEngine(db).diffChange(changeId);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      path: 'src/new.ts',
      isNewFile: true,
      addedLines: 2,
      removedLines: 0,
    });
    expect(diffs[0]?.hunks).toContain('+line1');
    expect(diffs[0]?.hunks).toContain('+line2');
  });

  it('uses the immediately previous write to the same path as the base', async () => {
    const seed = await seedRun(db, 'diff-base');
    const artifactId = await createArtifact(db, seed, 'src/app.ts');
    // Three writes; diffing the third must use the second as base, not the first.
    await appendChange(
      db,
      seed,
      artifactId,
      'v1\n',
      FileChangeType.Created,
      new Date('2026-01-01T00:00:00Z'),
    );
    await appendChange(
      db,
      seed,
      artifactId,
      'v1\nv2\n',
      FileChangeType.Modified,
      new Date('2026-01-02T00:00:00Z'),
    );
    const third = await appendChange(
      db,
      seed,
      artifactId,
      'v1\nv2\nv3\n',
      FileChangeType.Modified,
      new Date('2026-01-03T00:00:00Z'),
    );

    const diffs = await new DiffEngine(db).diffChange(third);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.addedLines).toBe(1); // only `+v3`
    expect(diffs[0]?.removedLines).toBe(0);
    expect(diffs[0]?.isNewFile).toBe(false);
  });

  it('returns an empty array for an unknown change id', async () => {
    await expect(new DiffEngine(db).diffChange(newChangeID())).resolves.toEqual([]);
  });
});
