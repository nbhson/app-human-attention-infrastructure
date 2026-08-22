/**
 * `ReviewService` integration test (day-22 §2).
 *
 * Exercises the real service against an isolated test schema. The two
 * cross-engine seams (`TaskTransition`, `FeedbackReporter`) are spies — the
 * package cannot import orchestrator/attention-engine (boundary R6), so the test
 * proves the service calls them correctly rather than their effects. The
 * database writes (guard flips, decision rows) and the published event are
 * asserted directly.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  agentRuns,
  artifacts,
  assessmentFeedback,
  assessments,
  changes,
  decisions,
  eventLog,
  projects,
  reviewQueue,
  tasks,
  users,
} from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import {
  EventType,
  HumanDecisionType,
  newAgentRunID,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newProjectID,
  newReviewQueueItemID,
  newReviewerID,
  newTaskID,
  newUserID,
  ReviewQueueStatus,
  TaskStatus,
} from '@harness/domain';
import type {
  AssessmentID,
  ChangeID,
  DecisionSubmittedPayload,
  ReviewQueueItemID,
  TaskID,
} from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';

import {
  MissingRationaleError,
  QueueConflictError,
  QueueItemNotFoundError,
  QueueStateError,
  ReviewService,
} from '../index.js';
import type { FeedbackReporter, TaskTransition } from '../index.js';

const SCHEMA = 'harness_test_review_pkg';

// Day-02 actor identity: a stable principal every deciding call is attributed to.
const ACTOR_ID = newUserID();
const ACTOR_EMAIL = 'reviewer-a@example.com';

let testDb: TestDb;
let bus: IEventBus;
let service: ReviewService;

const transitionSpy = vi.fn();
const reportSpy = vi.fn();

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  transitionSpy.mockReset();
  reportSpy.mockReset();

  bus = new InProcessEventBus();
  const taskTransition: TaskTransition = { transitionTask: transitionSpy };
  const reportFeedback: FeedbackReporter = { reportAssessmentFeedback: reportSpy };
  service = new ReviewService(testDb.db, bus, taskTransition, reportFeedback);

  // Truncate in FK order (children before parents).
  await testDb.db.delete(decisions);
  await testDb.db.delete(assessmentFeedback);
  await testDb.db.delete(reviewQueue);
  await testDb.db.delete(assessments);
  await testDb.db.delete(changes);
  await testDb.db.delete(artifacts);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
  await testDb.db.delete(eventLog);
  // Seed (then re-seed across tests) the actor principal so that
  // `decisions.actor_id`'s FK to users is satisfiable. Deleted last because
  // decisions/event_log reference it.
  await testDb.db.delete(users);
  await testDb.db.insert(users).values({
    id: ACTOR_ID,
    oidc_sub: `mock|${ACTOR_ID}`,
    email: ACTOR_EMAIL,
    display_name: 'Reviewer A',
    roles: ['REVIEWER'],
  });
});

interface Seed {
  readonly taskId: TaskID;
  readonly assessmentId: AssessmentID;
  readonly queueId: ReviewQueueItemID;
  readonly changeId: ChangeID;
}

/** Seed one QUEUED item with the full FK chain behind it. */
async function seedQueuedItem(opts: { position?: number } = {}): Promise<Seed> {
  const db = testDb.db;
  const projectId = newProjectID();
  const taskId = newTaskID();
  const agentRunId = newAgentRunID();
  const artifactId = newArtifactID();
  const changeId = newChangeID();
  const assessmentId = newAssessmentID();
  const queueId = newReviewQueueItemID();

  await db.insert(projects).values({ id: projectId, name: 'p', repo_path: '/tmp/p' });
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'Do the thing',
    state: TaskStatus.AwaitingReview,
    idempotency_key: `ik-${taskId}`,
  });
  await db.insert(agentRuns).values({
    id: agentRunId,
    task_id: taskId,
    status: 'COMPLETED',
    max_steps: 10,
  });
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/index.ts',
    status: 'PENDING_REVIEW',
  });
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: agentRunId,
    change_type: 'CREATED',
    status: 'VERIFIED',
    content_hash: 'h',
    diff_summary: 'new file',
  });
  await db.insert(assessments).values({
    id: assessmentId,
    artifact_id: artifactId,
    change_id: changeId,
    risk_score: 0.5,
    impact_score: 0.5,
    novelty_score: 0.5,
    complexity_score: 0.5,
    confidence_score: 0.5,
    combined_priority: 0.6,
    label: 'HIGH',
    factors_unavailable: [],
  });
  await db.insert(reviewQueue).values({
    id: queueId,
    task_id: taskId,
    assessment_id: assessmentId,
    action: 'REVIEW_REQUIRED',
    policy_version: 1,
    rule_id: 'r1',
    position: opts.position ?? 1,
    status: ReviewQueueStatus.Queued,
  });

  return { taskId, assessmentId, queueId, changeId };
}

describe('ReviewService', () => {
  it('listQueue returns items in ascending position order', async () => {
    const first = await seedQueuedItem({ position: 1 });
    const second = await seedQueuedItem({ position: 2 });

    const items = await service.listQueue();

    expect(items.map((item) => item.id)).toEqual([first.queueId, second.queueId]);
    expect(items[0]).toMatchObject({ status: 'QUEUED', claimedBy: null, claimedAt: null });
  });

  it('getDetail composes assessment, task, and a null decision when undecided', async () => {
    const { taskId, queueId } = await seedQueuedItem();

    const detail = await service.getDetail(queueId);

    expect(detail.id).toBe(queueId);
    expect(detail.taskId).toBe(taskId);
    expect(detail.label).toBe('HIGH');
    expect(detail.taskTitle).toBe('Do the thing');
    expect(detail.taskState).toBe(TaskStatus.AwaitingReview);
    expect(detail.decision).toBeNull();
  });

  it('getDetail throws for an unknown queue id', async () => {
    await expect(service.getDetail(newReviewQueueItemID())).rejects.toBeInstanceOf(
      QueueItemNotFoundError,
    );
  });

  it('claim assigns a reviewer; a second claim conflicts', async () => {
    const { queueId } = await seedQueuedItem();
    const reviewer = newReviewerID();

    const claimed = await service.claim(queueId, reviewer);
    expect(claimed.claimedBy).toBe(reviewer);
    expect(claimed.claimedAt).toBeInstanceOf(Date);

    await expect(service.claim(queueId, newReviewerID())).rejects.toBeInstanceOf(
      QueueConflictError,
    );
  });

  it('decide records the decision, drives the seam, publishes, and reports feedback', async () => {
    const { taskId, assessmentId, queueId } = await seedQueuedItem();
    const reviewer = newReviewerID();

    await service.claim(queueId, reviewer);

    const seen: DecisionSubmittedPayload[] = [];
    bus.subscribe<DecisionSubmittedPayload>(EventType.DecisionSubmitted, (event) => {
      seen.push(event.payload);
    });

    const detail = await service.decide(queueId, {
      decision: 'APPROVE',
      rationale: 'LGTM',
      wasUseful: true,
      comment: 'good',
      reviewerId: reviewer,
      actorId: ACTOR_ID,
      actorEmail: ACTOR_EMAIL,
    });

    expect(detail.status).toBe(ReviewQueueStatus.Decided);
    expect(detail.decision).toMatchObject({
      decision: HumanDecisionType.Approved,
      reviewerId: reviewer,
    });

    expect(transitionSpy).toHaveBeenCalledWith(taskId, TaskStatus.Approved, 'human', {
      rationale: 'LGTM',
      expectedFrom: TaskStatus.AwaitingReview,
    });
    expect(reportSpy).toHaveBeenCalledWith(assessmentId, true, 'good');

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      decision: HumanDecisionType.Approved,
      reviewer_id: reviewer,
    });

    const decisionRows = await testDb.db.select().from(decisions);
    expect(decisionRows).toHaveLength(1);
    expect(decisionRows[0]).toMatchObject({
      decision: 'APPROVED',
      reviewer_id: reviewer,
      actor_id: ACTOR_ID,
      actor_email: ACTOR_EMAIL,
      rationale: 'LGTM',
    });
  });

  it('decide REJECT drives the task to REJECTED', async () => {
    const { taskId, queueId } = await seedQueuedItem();
    const reviewer = newReviewerID();
    await service.claim(queueId, reviewer);

    await service.decide(queueId, {
      decision: 'REJECT',
      rationale: 'bad',
      wasUseful: false,
      reviewerId: reviewer,
      actorId: ACTOR_ID,
      actorEmail: ACTOR_EMAIL,
    });

    expect(transitionSpy).toHaveBeenCalledWith(taskId, TaskStatus.Rejected, 'human', {
      rationale: 'bad',
      expectedFrom: TaskStatus.AwaitingReview,
    });
  });

  it('decide on an unclaimed item is a state error', async () => {
    const { queueId } = await seedQueuedItem();

    await expect(
      service.decide(queueId, {
        decision: 'APPROVE',
        rationale: 'x',
        wasUseful: true,
        reviewerId: newReviewerID(),
        actorId: ACTOR_ID,
        actorEmail: ACTOR_EMAIL,
      }),
    ).rejects.toBeInstanceOf(QueueStateError);
  });

  it('drop requires a non-empty rationale', async () => {
    const { queueId } = await seedQueuedItem();

    await expect(
      service.drop(queueId, {
        rationale: '   ',
        reviewerId: newReviewerID(),
        actorId: ACTOR_ID,
        actorEmail: ACTOR_EMAIL,
      }),
    ).rejects.toBeInstanceOf(MissingRationaleError);
  });

  it('drop flags the item DROPPED and records a DEFERRED decision', async () => {
    const { changeId, queueId } = await seedQueuedItem();
    const reviewer = newReviewerID();

    await service.drop(queueId, {
      rationale: 'superseded',
      reviewerId: reviewer,
      actorId: ACTOR_ID,
      actorEmail: ACTOR_EMAIL,
    });

    const queueRows = await testDb.db.select().from(reviewQueue);
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0]?.status).toBe(ReviewQueueStatus.Dropped);

    const decisionRows = await testDb.db.select().from(decisions);
    expect(decisionRows).toHaveLength(1);
    expect(decisionRows[0]).toMatchObject({
      decision: HumanDecisionType.Deferred,
      change_id: changeId,
      reviewer_id: reviewer,
      actor_id: ACTOR_ID,
      rationale: 'superseded',
    });
  });

  it('drop on a decided item is a state error', async () => {
    const { queueId } = await seedQueuedItem();
    const reviewer = newReviewerID();
    await service.claim(queueId, reviewer);
    await service.decide(queueId, {
      decision: 'APPROVE',
      rationale: 'ok',
      wasUseful: true,
      reviewerId: reviewer,
      actorId: ACTOR_ID,
      actorEmail: ACTOR_EMAIL,
    });

    await expect(
      service.drop(queueId, {
        rationale: 'x',
        reviewerId: reviewer,
        actorId: ACTOR_ID,
        actorEmail: ACTOR_EMAIL,
      }),
    ).rejects.toBeInstanceOf(QueueStateError);
  });
});
