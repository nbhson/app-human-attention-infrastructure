import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns, artifacts, changes, contextSourceEmbeddings, projects, snapshots, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import {
  EventType,
  FileChangeType,
  newAgentRunID,
  newArtifactID,
  newChangeID,
  newCorrelationID,
  newProjectID,
  newTaskID,
  uuidv7,
} from '@harness/domain';
import type { AgentRunID, ArtifactChangedPayload, ArtifactCreatedPayload, ArtifactID, ChangeID } from '@harness/domain';
import { createEvent, InProcessEventBus } from '@harness/event-bus';

import { EmbeddingIndexer } from '../indexer.js';
import { StubEmbedder } from '../providers/stub.js';
import { ReembedListener } from '../reembed-listener.js';

const SCHEMA = 'harness_test_reembed';

let testDb: TestDb;
let db: DrizzleDB;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await db.delete(contextSourceEmbeddings);
  await db.delete(snapshots);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(tasks);
  await db.delete(projects);
});

function listener(indexer = new EmbeddingIndexer(db, new StubEmbedder(1536, 'test-model'))): ReembedListener {
  return new ReembedListener(db, indexer);
}

function createdPayload(): ArtifactCreatedPayload {
  return {
    agent_run_id: newAgentRunID(),
    file_path: 'src/created.ts',
    content_hash: 'hash-created',
    size_bytes: 7,
    content: 'inline content',
  };
}

interface ChangedFixture {
  artifactId: ArtifactID;
  changeId: ChangeID;
  agentRunId: AgentRunID;
  filePath: string;
  contentHash: string;
}

/** Seed the parent rows `resolveChangedSource` joins onto, plus the snapshot. */
async function seedChangedFixture(): Promise<ChangedFixture> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'p', repo_path: '/tmp/repo' });

  const taskId = newTaskID();
  await db.insert(tasks).values({ id: taskId, project_id: projectId, title: 't', idempotency_key: `${taskId}:0` });

  const agentRunId = newAgentRunID();
  await db.insert(agentRuns).values({ id: agentRunId, task_id: taskId, status: 'COMPLETED', max_steps: 5 });

  const artifactId = newArtifactID();
  const filePath = 'src/app.ts';
  await db.insert(artifacts).values({ id: artifactId, project_id: projectId, file_path: filePath, status: 'DRAFT' });

  const changeId = newChangeID();
  const contentHash = 'hash-updated';
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: agentRunId,
    change_type: FileChangeType.Modified,
    status: 'PENDING',
    content_hash: contentHash,
    diff_summary: 'edited app.ts',
  });

  await db.insert(snapshots).values({
    id: uuidv7(),
    change_id: changeId,
    content_hash: contentHash,
    content: 'updated file content',
    generation: 1,
  });

  return { artifactId, changeId, agentRunId, filePath, contentHash };
}

async function embeddingRows(sourceId: string) {
  return db.select().from(contextSourceEmbeddings).where(eq(contextSourceEmbeddings.source_id, sourceId));
}

/** Poll until a row for `sourceId` appears (the listener runs fire-and-forget). */
async function waitForEmbedding(sourceId: string): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    if ((await embeddingRows(sourceId)).length > 0) return;
    if (Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('ReembedListener', () => {
  it('subscribes to artifact.created and artifact.changed', () => {
    const bus = new InProcessEventBus();
    listener().subscribe(bus);

    expect(bus.subscriberCount(EventType.ArtifactCreated)).toBe(1);
    expect(bus.subscriberCount(EventType.ArtifactChanged)).toBe(1);
  });

  it('onCreated embeds the inline content as a FILE source', async () => {
    const payload = createdPayload();
    await listener().onCreated(payload);

    const rows = await embeddingRows(payload.file_path);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content_hash).toBe(payload.content_hash);
    expect(rows[0]?.embedded_at).not.toBeNull();
  });

  it('onChanged is a no-op when the artifact is unknown', async () => {
    const idx = new EmbeddingIndexer(db, new StubEmbedder(1536, 'test-model'));
    const runSpy = vi.spyOn(idx, 'run');
    const payload: ArtifactChangedPayload = {
      artifact_id: newArtifactID(),
      change_id: newChangeID(),
      change_type: FileChangeType.Modified,
      content_hash: 'hash-whatever',
      agent_run_id: newAgentRunID(),
    };

    await listener(idx).onChanged(payload);

    expect(runSpy).not.toHaveBeenCalled();
  });

  it('onChanged resolves and re-embeds the file source by latest snapshot', async () => {
    const fixture = await seedChangedFixture();
    const payload: ArtifactChangedPayload = {
      artifact_id: fixture.artifactId,
      change_id: fixture.changeId,
      change_type: FileChangeType.Modified,
      content_hash: fixture.contentHash,
      agent_run_id: fixture.agentRunId,
    };

    await listener().onChanged(payload);

    const rows = await embeddingRows(fixture.filePath);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content_hash).toBe(fixture.contentHash);
    expect(rows[0]?.embedded_at).not.toBeNull();
  });

  it('publishes nothing — handling is a side effect on the index only', async () => {
    const bus = new InProcessEventBus();
    const publishSpy = vi.spyOn(bus, 'publish');
    const payload = createdPayload();
    listener().subscribe(bus);

    bus.publish(createEvent(EventType.ArtifactCreated, newCorrelationID(), payload));
    await waitForEmbedding(payload.file_path);

    // The single recorded publish is our own trigger; the listener never re-emits.
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});
