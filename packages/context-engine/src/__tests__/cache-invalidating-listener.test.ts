import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { artifacts, contextSourceCache, projects } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { EventType, FileChangeType, newAgentRunID, newArtifactID, newChangeID, newProjectID } from '@harness/domain';
import type { ArtifactChangedPayload, ArtifactCreatedPayload } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';

import { CacheInvalidationListener } from '../cache/cache-invalidating-listener.js';
import { PostgresContextCache } from '../cache/context-cache.js';

const SCHEMA = 'harness_test_cache_invalidation';

let testDb: TestDb;
let db: DrizzleDB;
let cache: PostgresContextCache;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
  cache = new PostgresContextCache(db);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await db.delete(contextSourceCache);
  await db.delete(artifacts);
  await db.delete(projects);
});

async function seedCached(sourceId: string): Promise<void> {
  await cache.set({
    sourceId,
    contentHash: 'hash-being-tested',
    content: 'cached content',
    mtimeMs: 1000,
    size: 14,
  });
}

async function cachedCount(sourceId: string): Promise<number> {
  return (await db.select().from(contextSourceCache).where(eq(contextSourceCache.source_id, sourceId))).length;
}

function createdPayload(filePath: string): ArtifactCreatedPayload {
  return {
    agent_run_id: newAgentRunID(),
    file_path: filePath,
    content_hash: 'hash-created',
    size_bytes: 7,
    content: 'inline content',
  };
}

function listener(): CacheInvalidationListener {
  return new CacheInvalidationListener(db, cache);
}

describe('CacheInvalidationListener (day-20 §2.2)', () => {
  it('subscribes to artifact.created and artifact.changed', () => {
    const bus = new InProcessEventBus();
    listener().subscribe(bus);

    expect(bus.subscriberCount(EventType.ArtifactCreated)).toBe(1);
    expect(bus.subscriberCount(EventType.ArtifactChanged)).toBe(1);
  });

  it('onCreated invalidates by the inline file_path', async () => {
    await seedCached('src/created.ts');
    expect(await cachedCount('src/created.ts')).toBe(1);

    await listener().onCreated(createdPayload('src/created.ts'));

    expect(await cachedCount('src/created.ts')).toBe(0);
  });

  it('onChanged resolves artifact_id → file_path and invalidates', async () => {
    const projectId = newProjectID();
    await db.insert(projects).values({ id: projectId, name: 'p', repo_path: '/tmp/repo' });

    const artifactId = newArtifactID();
    await db
      .insert(artifacts)
      .values({ id: artifactId, project_id: projectId, file_path: 'src/app.ts', status: 'DRAFT' });

    await seedCached('src/app.ts');
    expect(await cachedCount('src/app.ts')).toBe(1);

    const payload: ArtifactChangedPayload = {
      artifact_id: artifactId,
      change_id: newChangeID(),
      change_type: FileChangeType.Modified,
      content_hash: 'hash-updated',
      agent_run_id: newAgentRunID(),
    };
    await listener().onChanged(payload);

    expect(await cachedCount('src/app.ts')).toBe(0);
  });

  it('onChanged is a no-op when the artifact is unknown', async () => {
    await seedCached('src/untouched.ts');

    const payload: ArtifactChangedPayload = {
      artifact_id: newArtifactID(), // never inserted
      change_id: newChangeID(),
      change_type: FileChangeType.Modified,
      content_hash: 'hash-whatever',
      agent_run_id: newAgentRunID(),
    };
    await listener().onChanged(payload);

    expect(await cachedCount('src/untouched.ts')).toBe(1);
  });
});
