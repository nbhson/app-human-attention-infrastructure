/**
 * Day-28 C7 — parallel worktrees, shared files, no cross-contamination.
 *
 * `SnapshotStore` is content-addressed: `content_hash = SHA-256(content)`, so a
 * snapshot always resolves to the exact bytes its own task wrote. Five tasks each
 * writing `src/shared.ts` (in their own isolated worktree) are modelled here as
 * five changes whose snapshots are saved concurrently across two independent
 * connections — the invariant is that each hash maps to *its own* content only.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { agentRuns, artifacts, changes, projects, snapshots, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import {
  createTestDb,
  destroyTestDb,
  openTestDbConnection,
  type TestDb,
} from '@harness/db/test-utils';
import {
  newAgentRunID,
  newArtifactID,
  newChangeID,
  newProjectID,
  newTaskID,
  TaskStatus,
} from '@harness/domain';
import type { ChangeID } from '@harness/domain';
import { sha256, SnapshotStore } from '@harness/artifact-tracker';

const SCHEMA = 'harness_test_concurrency_worktree';

let testDb: TestDb; // connection A
let peer: TestDb; // connection B

/** Seed the full FK chain behind a `change` row (a "worktree" writing shared.ts). */
async function seedChange(db: DrizzleDB): Promise<ChangeID> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'wt', repo_path: '/tmp/wt' });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'wt',
    state: TaskStatus.Executing,
    idempotency_key: `${taskId}:0`,
  });

  const runId = newAgentRunID();
  await db.insert(agentRuns).values({
    id: runId,
    task_id: taskId,
    status: 'EXECUTING',
    max_steps: 10,
  });

  const artifactId = newArtifactID();
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/shared.ts',
    status: 'DRAFT',
  });

  const changeId = newChangeID();
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: runId,
    change_type: 'CREATED',
    status: 'PENDING',
    content_hash: 'seed-hash',
    diff_summary: 'wrote src/shared.ts',
  });

  return changeId;
}

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  peer = await openTestDbConnection(SCHEMA);
});

afterAll(async () => {
  await peer.sql.end();
  await destroyTestDb(testDb, SCHEMA);
});

describe('Day-28 C7 — parallel worktrees', () => {
  it('five concurrent shared-file writes stay isolated by content hash', async () => {
    const store = new SnapshotStore();
    const contents = ['wt-A', 'wt-B', 'wt-C', 'wt-D', 'wt-E'];

    const changeIds: ChangeID[] = [];
    for (let i = 0; i < contents.length; i++) {
      changeIds.push(await seedChange(testDb.db));
    }

    // Race the five saves across both connections (distinct content → no dedup).
    await Promise.all(
      contents.map((content, i) =>
        store.save(i % 2 === 0 ? testDb.db : peer.db, changeIds[i]!, content),
      ),
    );

    const rows = await testDb.db.select().from(snapshots);
    expect(rows).toHaveLength(contents.length);

    // Content-addressing: every hash resolves to its own content, never a sibling's.
    const byHash = new Map(rows.map((row) => [row.content_hash, row.content]));
    for (const content of contents) {
      expect(byHash.get(sha256(content))).toBe(content);
    }

    // Distinct blobs produce distinct hashes — no cross-worktree collision.
    expect(new Set(rows.map((row) => row.content_hash)).size).toBe(contents.length);
  });
});
