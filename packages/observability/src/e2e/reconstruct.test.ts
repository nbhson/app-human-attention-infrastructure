import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  agentRuns,
  artifacts,
  assessments,
  changes,
  decisions,
  eventLog,
  projects,
  tasks,
  traceCorrelation,
  users,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import {
  ArtifactStatus,
  ChangeStatus,
  FileChangeType,
  newAssessmentID,
  newAgentRunID,
  newArtifactID,
  newChangeID,
  newDecisionID,
  newProjectID,
  newTaskID,
  newUserID,
  uuidv7,
} from '@harness/domain';

import { reconstruct, TelemetryIntegrityError } from './reconstruct.js';

const SCHEMA = 'harness_test_reconstruct';

let testDb: TestDb;
let db: DrizzleDB;

/** A full base FK graph so the dump tables (decisions, verification_reports) insert. */
interface Seed {
  projectId: string;
  taskId: string;
  changeId: string;
  assessmentId: string;
  userId: string;
}

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // Reverse-FK order so no foreign key complains.
  await db.delete(decisions);
  await db.delete(verificationReports);
  await db.delete(assessments);
  await db.delete(eventLog);
  await db.delete(traceCorrelation);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(tasks);
  await db.delete(projects);
  await db.delete(users);
});

async function seedBase(): Promise<Seed> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'reconstruct', repo_path: '/tmp/rc' });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'reconstruct fixture',
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
    file_path: 'src/greeting.ts',
    status: ArtifactStatus.Draft,
  });

  const changeId = newChangeID();
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: runId,
    change_type: FileChangeType.Created,
    status: ChangeStatus.Pending,
    content_hash: 'hash',
    diff_summary: 'created src/greeting.ts',
  });

  const assessmentId = newAssessmentID();
  await db.insert(assessments).values({
    id: assessmentId,
    artifact_id: artifactId,
    change_id: changeId,
    risk_score: 0.5,
    impact_score: 0.5,
    novelty_score: 0.5,
    complexity_score: 0.5,
    confidence_score: 0.5,
    combined_priority: 0.5,
    label: 'MEDIUM',
    factors_unavailable: [],
  });

  const userId = newUserID();
  await db.insert(users).values({
    id: userId,
    oidc_sub: `mock|${userId}`,
    email: 'reviewer@example.com',
    display_name: 'Reviewer',
    roles: ['OPERATOR', 'REVIEWER'],
  });

  return { projectId, taskId, changeId, assessmentId, userId };
}

function traceRow(
  taskId: string,
  traceId: string,
): {
  trace_id: string;
  span_id: string;
  correlation_id: string;
} {
  return { trace_id: traceId, span_id: 'b'.repeat(16), correlation_id: taskId };
}

describe('reconstruct (day-27 §3.3)', () => {
  it('maps trace ↔ correlation and replays events, decisions, and verifications', async () => {
    const { taskId, changeId, assessmentId, userId } = await seedBase();
    const traceId = 'a'.repeat(32);

    await db.insert(traceCorrelation).values(traceRow(taskId, traceId));

    await db.insert(eventLog).values([
      {
        event_id: uuidv7(),
        event_type: 'task.created',
        event_version: 1,
        occurred_at: new Date('2026-08-01T00:00:00.000Z'),
        correlation_id: taskId,
        actor_id: null,
        payload: {},
      },
      {
        event_id: uuidv7(),
        event_type: 'verification.completed',
        event_version: 1,
        occurred_at: new Date('2026-08-01T00:00:01.000Z'),
        correlation_id: taskId,
        actor_id: null,
        payload: { result_id: newDecisionID() },
      },
    ]);

    // The review step carries the session actor (day-02); reconstruct asserts it.
    const submitId = uuidv7();
    await db.insert(eventLog).values({
      event_id: submitId,
      event_type: 'review.decision_submitted',
      event_version: 2,
      occurred_at: new Date('2026-08-01T00:00:02.000Z'),
      correlation_id: taskId,
      actor_id: userId,
      payload: { decision: 'APPROVED' },
    });

    await db.insert(verificationReports).values({
      id: uuidv7(),
      correlation_id: taskId,
      change_id: changeId,
      task_id: taskId,
      overall: 'PASSED',
      duration_ms: 42,
      content_hash: 'a'.repeat(64),
      flaky: false,
    });

    await db.insert(decisions).values({
      id: newDecisionID(),
      correlation_id: taskId,
      change_id: changeId,
      assessment_id: assessmentId,
      decision: 'APPROVED',
      reviewer_id: 'reviewer-1',
      actor_id: userId,
      actor_email: 'reviewer@example.com',
      rationale: 'correct',
    });

    const run = await reconstruct(db, taskId);

    expect(run.traceId).toBe(traceId);
    // Replay in causal order: created → completed → decision_submitted.
    expect(run.events.map((e) => e.eventType)).toEqual([
      'task.created',
      'verification.completed',
      'review.decision_submitted',
    ]);
    expect(run.decisions).toHaveLength(1);
    expect(run.decisions[0]?.actorId).toBe(userId);
    expect(run.verifications).toHaveLength(1);
    expect(run.verifications[0]?.contentHash).toBe('a'.repeat(64));
  });

  it('returns a null traceId (not a throw) when no root span wrote trace_correlation', async () => {
    const { taskId, changeId } = await seedBase();

    await db.insert(eventLog).values({
      event_id: uuidv7(),
      event_type: 'task.created',
      event_version: 1,
      occurred_at: new Date('2026-08-01T00:00:00.000Z'),
      correlation_id: taskId,
      actor_id: null,
      payload: {},
    });
    await db.insert(verificationReports).values({
      id: uuidv7(),
      correlation_id: taskId,
      change_id: changeId,
      task_id: taskId,
      overall: 'PASSED',
      duration_ms: 1,
      content_hash: 'a'.repeat(64),
    });

    const run = await reconstruct(db, taskId);
    expect(run.traceId).toBeNull();
  });

  it('treats an un-attributed review.decision_submitted as a red run', async () => {
    const { taskId } = await seedBase();

    await db.insert(eventLog).values({
      event_id: uuidv7(),
      event_type: 'review.decision_submitted',
      event_version: 2,
      occurred_at: new Date('2026-08-01T00:00:00.000Z'),
      correlation_id: taskId,
      actor_id: null, // no identity → non-reconstructible
      payload: { decision: 'APPROVED' },
    });

    await expect(reconstruct(db, taskId)).rejects.toBeInstanceOf(TelemetryIntegrityError);
  });

  it('treats a content-hash-less verification report as a red run', async () => {
    const { taskId, changeId, userId } = await seedBase();

    await db.insert(eventLog).values({
      event_id: uuidv7(),
      event_type: 'review.decision_submitted',
      event_version: 2,
      occurred_at: new Date('2026-08-01T00:00:00.000Z'),
      correlation_id: taskId,
      actor_id: userId,
      payload: { decision: 'APPROVED' },
    });

    await db.insert(verificationReports).values({
      id: uuidv7(),
      correlation_id: taskId,
      change_id: changeId,
      task_id: taskId,
      overall: 'PASSED',
      duration_ms: 1,
      content_hash: null, // no hash → not attributable to any bytes
    });

    await expect(reconstruct(db, taskId)).rejects.toBeInstanceOf(TelemetryIntegrityError);
  });
});
