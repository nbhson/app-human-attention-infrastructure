/**
 * `MergeService` integration test (day-24 §5) — the approve path against a real
 * `TaskService` (state machine + guard) and a fake {@link GitAdapter}. Seeding
 * goes through the real tables; the git boundary is a spy so the test asserts the
 * file set, commit message, DB writes, and published events without hitting disk.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  agentRuns,
  artifacts,
  assessments,
  changes,
  decisions,
  projects,
  reviewQueue,
  snapshots,
  taskStateHistory,
  tasks,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import {
  ArtifactStatus,
  EventType,
  newAgentRunID,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newDecisionID,
  newProjectID,
  newSnapshotID,
  newTaskID,
  TaskStatus,
} from '@harness/domain';
import type { EventEnvelope, TaskID } from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';
import { TaskService, TaskStateMachine } from '@harness/orchestrator';

import { MergeConflictError } from '../services/git-adapter.js';
import type { ArtifactFile, GitAdapter } from '../services/git-adapter.js';
import { MergeService } from '../services/merge.js';

/** A bus that records every published envelope (no dispatch needed here). */
class RecordingBus implements IEventBus {
  readonly published: EventEnvelope[] = [];

  publish<T>(event: EventEnvelope<T>): void {
    this.published.push(event);
  }

  subscribe<T>(_eventType: EventType, _handler: EventHandler<T>): UnsubscribeFn {
    void _eventType;
    void _handler;
    return () => {};
  }
}

const SCHEMA = 'harness_test_merge';

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
  await db.delete(decisions);
  await db.delete(reviewQueue);
  await db.delete(assessments);
  await db.delete(snapshots);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(taskStateHistory);
  await db.delete(tasks);
  await db.delete(projects);
});

/** A fake GitAdapter that records its inputs and returns (or throws) `outcome`. */
function makeGit(outcome: string | Error = 'abc123'): {
  git: GitAdapter;
  calls: Array<{ files: ArtifactFile[]; message: string }>;
} {
  const calls: Array<{ files: ArtifactFile[]; message: string }> = [];
  const git: GitAdapter = {
    async applyAndCommit(files, options) {
      calls.push({ files: [...files], message: options.message });
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    },
  };
  return { git, calls };
}

function buildMergeService(git: GitAdapter, bus: IEventBus): MergeService {
  const taskService = new TaskService(db, bus, new TaskStateMachine());
  return new MergeService(db, bus, git, taskService);
}

/** Seed an APPROVED task with one reviewed file + its snapshot + a decision. */
async function seedApprovedTask(attemptNumber = 0): Promise<{
  taskId: TaskID;
  changeId: string;
  artifactId: string;
}> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'merge', repo_path: '/tmp/merge' });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'Merge me',
    state: TaskStatus.Approved,
    attempt_number: attemptNumber,
    max_attempts: 3,
    idempotency_key: `${taskId}:${attemptNumber}`,
  });

  const runId = newAgentRunID();
  await db.insert(agentRuns).values({
    id: runId,
    task_id: taskId,
    attempt_number: attemptNumber,
    status: 'COMPLETED',
    max_steps: 10,
  });

  const artifactId = newArtifactID();
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/app.ts',
    status: ArtifactStatus.Approved,
  });

  const changeId = newChangeID();
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: runId,
    change_type: 'CREATED',
    status: 'REVIEWED',
    content_hash: 'h1',
    diff_summary: 'created src/app.ts',
  });
  await db.insert(snapshots).values({
    id: newSnapshotID(),
    change_id: changeId,
    content_hash: 'h1',
    content: 'export const x = 1;',
    generation: 1,
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
    combined_priority: 0.75,
    label: 'HIGH',
    factors_unavailable: [],
  });
  await db.insert(decisions).values({
    id: newDecisionID(),
    change_id: changeId,
    assessment_id: assessmentId,
    decision: 'APPROVED',
    reviewer_id: 'reviewer-1',
    rationale: 'LGTM',
  });

  return { taskId, changeId, artifactId };
}

async function stateOf(taskId: TaskID): Promise<string | null> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId));
  return rows[0]?.state ?? null;
}

async function commitShaOf(changeId: string): Promise<string | null> {
  const rows = await db.select().from(changes).where(eq(changes.id, changeId));
  return rows[0]?.commit_sha ?? null;
}

async function artifactStatusOf(artifactId: string): Promise<string | null> {
  const rows = await db.select().from(artifacts).where(eq(artifacts.id, artifactId));
  return rows[0]?.status ?? null;
}

describe('MergeService', () => {
  it('approve: commits files, marks MERGED, records commit_sha, publishes artifact.merged', async () => {
    const { taskId, changeId, artifactId } = await seedApprovedTask();
    const { git, calls } = makeGit('sha-123');
    const bus = new RecordingBus();
    const merge = buildMergeService(git, bus);

    await merge.onApproved(taskId);

    expect(await stateOf(taskId)).toBe(TaskStatus.Completed);
    expect(await commitShaOf(changeId)).toBe('sha-123');
    expect(await artifactStatusOf(artifactId)).toBe(ArtifactStatus.Merged);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.message).toContain('Reviewed-by: reviewer-1');
    expect(calls[0]?.files).toEqual([{ filePath: 'src/app.ts', content: 'export const x = 1;' }]);

    const merged = bus.published.find((event) => event.event_type === EventType.ArtifactMerged);
    expect(merged?.payload).toMatchObject({ task_id: taskId, commit_sha: 'sha-123' });
  });

  it('a duplicate APPROVED event is a no-op (guarded on the current state)', async () => {
    const { taskId } = await seedApprovedTask();
    const { git, calls } = makeGit('sha-123');
    const bus = new RecordingBus();
    const merge = buildMergeService(git, bus);

    await merge.onApproved(taskId);
    await merge.onApproved(taskId);

    expect(calls).toHaveLength(1);
    expect(await stateOf(taskId)).toBe(TaskStatus.Completed);
  });

  it('a merge conflict routes to AWAITING_HUMAN_INTERVENTION with no partial commit', async () => {
    const { taskId, changeId, artifactId } = await seedApprovedTask();
    const { git } = makeGit(new MergeConflictError('/tmp/merge'));
    const bus = new RecordingBus();
    const merge = buildMergeService(git, bus);

    await merge.onApproved(taskId);

    expect(await stateOf(taskId)).toBe(TaskStatus.AwaitingHumanIntervention);
    expect(await commitShaOf(changeId)).toBeNull();
    expect(await artifactStatusOf(artifactId)).not.toBe(ArtifactStatus.Merged);
    expect(bus.published.some((event) => event.event_type === EventType.ArtifactMerged)).toBe(
      false,
    );
  });
});
