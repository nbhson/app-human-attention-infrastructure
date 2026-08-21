import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AgentRunStatus,
  ArtifactStatus,
  ChangeStatus,
  EventType,
  FileChangeType,
  newAgentRunID,
  newArtifactID,
  newChangeID,
  newCorrelationID,
  newEventID,
  newProjectID,
  newTaskID,
} from '@harness/domain';

import { createTestDb, destroyTestDb, type TestDb } from './__tests__/helpers.js';
import { agentRuns, artifacts, changes, eventLog, projects, tasks } from './schema/index.js';

const SCHEMA = 'harness_test_index';
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

interface Chain {
  readonly projectId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly artifactId: string;
}

/** Insert a project → task → agent_run → artifact chain and return the ids. */
async function makeChain(): Promise<Chain> {
  const projectId = newProjectID();
  await testDb.db.insert(projects).values({ id: projectId, name: 'p', repo_path: '/r' });

  const taskId = newTaskID();
  await testDb.db
    .insert(tasks)
    .values({ id: taskId, project_id: projectId, title: 't', idempotency_key: `key-${taskId}` });

  const runId = newAgentRunID();
  await testDb.db
    .insert(agentRuns)
    .values({ id: runId, task_id: taskId, status: AgentRunStatus.Completed, max_steps: 10 });

  const artifactId = newArtifactID();
  await testDb.db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/index.ts',
    status: ArtifactStatus.Draft,
  });

  return { projectId, taskId, runId, artifactId };
}

describe('@harness/db schema', () => {
  it('applies all 13 tables to the isolated schema', async () => {
    const rows = await testDb.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = ${SCHEMA}
    `;
    const names = new Set(rows.map((row) => row.table_name));
    const expected = [
      'projects',
      'tasks',
      'agent_runs',
      'artifacts',
      'changes',
      'snapshots',
      'contexts',
      'verification_requests',
      'verification_results',
      'assessments',
      'decisions',
      'event_log',
      'task_state_history',
    ];
    for (const table of expected) {
      expect(names.has(table), `missing table ${table}`).toBe(true);
    }
  });

  it('rejects duplicate tasks.idempotency_key', async () => {
    const projectId = newProjectID();
    await testDb.db.insert(projects).values({ id: projectId, name: 'p', repo_path: '/r' });
    const key = 'duplicate-key';

    await testDb.db
      .insert(tasks)
      .values({ id: newTaskID(), project_id: projectId, title: 't1', idempotency_key: key });

    await expect(
      testDb.db
        .insert(tasks)
        .values({ id: newTaskID(), project_id: projectId, title: 't2', idempotency_key: key }),
    ).rejects.toThrow();
  });

  it('tasks.state CHECK rejects an invalid state', async () => {
    const projectId = newProjectID();
    await testDb.db.insert(projects).values({ id: projectId, name: 'p', repo_path: '/r' });

    await expect(
      testDb.db.insert(tasks).values({
        id: newTaskID(),
        project_id: projectId,
        title: 't',
        idempotency_key: 'k',
        state: 'NOT_A_STATE',
      }),
    ).rejects.toThrow();
  });

  it('queries event_log by correlation_id', async () => {
    const correlationId = newCorrelationID();
    const other = newCorrelationID();
    const base = {
      event_type: EventType.TaskCreated,
      event_version: 1,
      occurred_at: new Date(),
      payload: { task_id: 'x' },
    };

    await testDb.db.insert(eventLog).values([
      { event_id: newEventID(), correlation_id: correlationId, ...base },
      { event_id: newEventID(), correlation_id: correlationId, ...base },
      { event_id: newEventID(), correlation_id: other, ...base },
    ]);

    const rows = await testDb.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.correlation_id, correlationId));
    expect(rows).toHaveLength(2);
  });

  it('event_log duplicate event_id insert is a silent no-op', async () => {
    const eventId = newEventID();
    const row = {
      event_id: eventId,
      event_type: EventType.TaskCreated,
      event_version: 1,
      occurred_at: new Date(),
      correlation_id: newCorrelationID(),
      payload: { task_id: 'x' },
    };

    await testDb.db.insert(eventLog).values(row);
    await testDb.db.insert(eventLog).values(row).onConflictDoNothing();

    const rows = await testDb.db.select().from(eventLog).where(eq(eventLog.event_id, eventId));
    expect(rows).toHaveLength(1);
  });

  it('changes.commit_sha is nullable in Phase 1', async () => {
    const { runId, artifactId } = await makeChain();
    const changeId = newChangeID();

    await testDb.db.insert(changes).values({
      id: changeId,
      artifact_id: artifactId,
      agent_run_id: runId,
      change_type: FileChangeType.Modified,
      status: ChangeStatus.Pending,
      content_hash: 'abc123',
      diff_summary: 'modified',
      commit_sha: null,
    });

    const rows = await testDb.db.select().from(changes).where(eq(changes.id, changeId));
    expect(rows[0]?.commit_sha).toBeNull();
  });

  it('rejects changes with an orphaned artifact_id', async () => {
    const { runId } = await makeChain();

    await expect(
      testDb.db.insert(changes).values({
        id: newChangeID(),
        artifact_id: 'does-not-exist',
        agent_run_id: runId,
        change_type: FileChangeType.Created,
        status: ChangeStatus.Pending,
        content_hash: 'abc123',
        diff_summary: 'new file',
      }),
    ).rejects.toThrow();
  });
});
