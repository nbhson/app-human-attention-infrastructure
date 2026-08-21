import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ArtifactStatus,
  ChangeStatus,
  EventType,
  FileChangeType,
  newAgentRunID,
  newArtifactID,
  newChangeID,
  newCorrelationID,
  newProjectID,
  newSnapshotID,
  newTaskID,
  TaskStatus,
  uuidv7,
} from '@harness/domain';
import type { ArtifactID, AssessmentCreatedPayload, ChangeID, TaskID } from '@harness/domain';
import {
  agentRuns,
  artifacts,
  assessments,
  changes,
  projects,
  snapshots,
  tasks,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { createEvent, InProcessEventBus } from '@harness/event-bus';

import { AttentionSubscriber } from '../attention-subscriber.js';

const SCHEMA = 'harness_test_attention_subscriber';

interface Seed {
  readonly taskId: TaskID;
  readonly artifactId: ArtifactID;
  readonly changeId: ChangeID;
}

let testDb: TestDb;
let db: DrizzleDB;
let bus: InProcessEventBus;
let created: AssessmentCreatedPayload[];

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  bus = new InProcessEventBus();
  created = [];

  // FK order: children before parents. retry_log / trajectory_steps are never
  // seeded here, so only the seeded chain's tables need clearing.
  await db.delete(verificationReports);
  await db.delete(snapshots);
  await db.delete(assessments);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(tasks);
  await db.delete(projects);
});

/** Seed `projects → tasks → agent_runs → artifacts → changes → snapshots` plus a PASSED report. */
async function seedChain(): Promise<Seed> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'attn', repo_path: '/tmp/attn' });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'attn',
    state: TaskStatus.Executing,
    idempotency_key: `${taskId}:0`,
  });

  const runId = newAgentRunID();
  await db.insert(agentRuns).values({
    id: runId,
    task_id: taskId,
    attempt_number: 0,
    status: 'EXECUTING',
    max_steps: 10,
  });

  const artifactId = newArtifactID();
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/app.ts',
    status: ArtifactStatus.Draft,
  });

  const changeId = newChangeID();
  const hash = 'snap-hash';
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: runId,
    change_type: FileChangeType.Created,
    status: ChangeStatus.Pending,
    content_hash: hash,
    diff_summary: 'created src/app.ts',
  });
  await db.insert(snapshots).values({
    id: newSnapshotID(),
    change_id: changeId,
    content_hash: hash,
    content: 'line1\nline2\nline3',
    generation: 1,
  });
  await db.insert(verificationReports).values({
    id: uuidv7(),
    change_id: changeId,
    task_id: taskId,
    overall: 'PASSED',
    duration_ms: 10,
  });

  return { taskId, artifactId, changeId };
}

/** Poll until `fn` returns something, because the subscriber's handler is fire-and-forget. */
async function waitFor<T>(fn: () => T | undefined, timeoutMs = 4_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for async work');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('AttentionSubscriber', () => {
  it('persists an assessment with plausible scores for a task', async () => {
    const { taskId, artifactId, changeId } = await seedChain();

    const assessment = await new AttentionSubscriber(db).assess(taskId);
    if (!assessment) {
      throw new Error('expected an assessment');
    }

    expect(assessment).toMatchObject({ taskId, artifactId, changeId });
    expect(assessment.combinedPriority).toBeGreaterThan(0);
    expect(assessment.combinedPriority).toBeLessThan(0.3);
    expect(assessment.label).toBe('LOW');
    expect(assessment.factorsUnavailable).toEqual([]);

    const rows = await db.select().from(assessments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: assessment.id,
      artifact_id: artifactId,
      change_id: changeId,
      label: 'LOW',
    });
    // `combined_priority` is a `real` (float4) column, so the persisted value is
    // rounded slightly vs the in-memory double.
    expect(rows[0]?.combined_priority).toBeCloseTo(assessment.combinedPriority, 4);
    expect(rows[0]?.factors_unavailable).toEqual([]);
  });

  it('publishes attention.assessment_created when a task reaches AWAITING_REVIEW', async () => {
    const { taskId, artifactId } = await seedChain();

    bus.subscribe<AssessmentCreatedPayload>(EventType.AssessmentCreated, (event) => {
      created.push(event.payload);
    });
    const subscriber = new AttentionSubscriber(db);
    subscriber.subscribe(bus);

    bus.publish(
      createEvent(EventType.TaskStateChanged, newCorrelationID(), {
        task_id: taskId,
        from_state: TaskStatus.Executing,
        to_state: TaskStatus.AwaitingReview,
        triggered_by: 'verification_engine',
        attempt_number: 1,
      }),
    );

    const payload = await waitFor(() => created[0]);
    expect(payload.artifact_id).toBe(artifactId);
    expect(payload.label).toBe('LOW');
    expect(payload.combined_priority).toBeGreaterThan(0);

    const rows = await db.select().from(assessments);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(payload.assessment_id);
  });

  it('ignores transitions to states other than AWAITING_REVIEW', async () => {
    const { taskId } = await seedChain();

    bus.subscribe<AssessmentCreatedPayload>(EventType.AssessmentCreated, (event) => {
      created.push(event.payload);
    });
    const subscriber = new AttentionSubscriber(db);
    subscriber.subscribe(bus);

    bus.publish(
      createEvent(EventType.TaskStateChanged, newCorrelationID(), {
        task_id: taskId,
        from_state: TaskStatus.Executing,
        to_state: TaskStatus.Rework,
        triggered_by: 'verification_engine',
        attempt_number: 1,
      }),
    );

    // Settle any (skipped) handler work, then assert nothing was produced.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toHaveLength(0);

    const rows = await db.select().from(assessments);
    expect(rows).toHaveLength(0);
  });

  it('returns null for a task with no change', async () => {
    const projectId = newProjectID();
    await db.insert(projects).values({ id: projectId, name: 'empty', repo_path: '/tmp/empty' });

    const taskId = newTaskID();
    await db.insert(tasks).values({
      id: taskId,
      project_id: projectId,
      title: 'empty',
      state: TaskStatus.Executing,
      idempotency_key: `${taskId}:0`,
    });

    await expect(new AttentionSubscriber(db).assess(taskId)).resolves.toBeNull();
  });
});
