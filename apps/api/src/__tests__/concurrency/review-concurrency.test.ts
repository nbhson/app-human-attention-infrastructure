/**
 * Day-28 C4 + C5 — double review claim / double decide.
 *
 * `ReviewService.claim` is a guarded `UPDATE ... WHERE status = QUEUED`; `decide`
 * guards `CLAIMED → DECIDED` the same way. Two reviewers (each on their own
 * independent connection) racing the same queue item must resolve to exactly one
 * winner and a single-valued `claimed_by` / a single `review_decisions` row.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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
import type { ReviewQueueItemID, ReviewerID } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { QueueConflictError, QueueStateError, ReviewService } from '@harness/review';
import type { FeedbackReporter, TaskTransition } from '@harness/review';

const SCHEMA = 'harness_test_concurrency_review';

let testDb: TestDb; // connection A
let peer: TestDb; // connection B

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  peer = await openTestDbConnection(SCHEMA);
});

afterAll(async () => {
  await peer.sql.end();
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // Truncate in FK order (children before parents).
  await testDb.db.delete(assessmentFeedback);
  await testDb.db.delete(decisions);
  await testDb.db.delete(reviewQueue);
  await testDb.db.delete(assessments);
  await testDb.db.delete(changes);
  await testDb.db.delete(artifacts);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
  await testDb.db.delete(eventLog);
});

interface Seed {
  readonly queueId: ReviewQueueItemID;
}

/** Seed one QUEUED item with the full FK chain behind it. */
async function seedQueuedItem(): Promise<Seed> {
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
    position: 1,
    status: ReviewQueueStatus.Queued,
  });

  return { queueId };
}

function buildService(
  db: DrizzleDB,
  bus: IEventBus,
  transitionSpy: ReturnType<typeof vi.fn>,
  reportSpy: ReturnType<typeof vi.fn>,
): ReviewService {
  const taskTransition: TaskTransition = { transitionTask: transitionSpy };
  const reportFeedback: FeedbackReporter = { reportAssessmentFeedback: reportSpy };
  return new ReviewService(db, bus, taskTransition, reportFeedback);
}

describe('Day-28 C4 — double review claim', () => {
  it('two concurrent claims: one wins, one conflicts, claimed_by single-valued', async () => {
    const { queueId } = await seedQueuedItem();
    const reviewerA = newReviewerID();
    const reviewerB = newReviewerID();

    const transitionSpy = vi.fn();
    const reportSpy = vi.fn();
    const svcA = buildService(testDb.db, new InProcessEventBus(), transitionSpy, reportSpy);
    const svcB = buildService(peer.db, new InProcessEventBus(), transitionSpy, reportSpy);

    const results = await Promise.allSettled([
      svcA.claim(queueId, reviewerA),
      svcB.claim(queueId, reviewerB),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(QueueConflictError);

    const rows = await testDb.db
      .select({ status: reviewQueue.status, claimed_by: reviewQueue.claimed_by })
      .from(reviewQueue)
      .where(eq(reviewQueue.id, queueId));
    expect(rows[0]?.status).toBe(ReviewQueueStatus.Claimed);
    // Single-valued: exactly one of the two reviewers holds the claim.
    expect([reviewerA, reviewerB] as ReviewerID[]).toContain(rows[0]?.claimed_by as ReviewerID);
  });
});

describe('Day-28 C5 — double decide', () => {
  it('two concurrent decides: one wins, one conflicts, exactly one decision row', async () => {
    const { queueId } = await seedQueuedItem();
    const reviewer = newReviewerID();
    const actorId = newUserID();

    const transitionSpy = vi.fn();
    const reportSpy = vi.fn();
    const svcA = buildService(testDb.db, new InProcessEventBus(), transitionSpy, reportSpy);
    const svcB = buildService(peer.db, new InProcessEventBus(), transitionSpy, reportSpy);

    // Setup: one reviewer claims the item first.
    await svcA.claim(queueId, reviewer);

    // The claim is attributed to a real principal (decisions.actor_id FK).
    await testDb.db.insert(users).values({
      id: actorId,
      oidc_sub: `mock|${actorId}`,
      email: 'reviewer@example.com',
      display_name: 'Reviewer',
      roles: ['REVIEWER'],
    });

    const input = {
      decision: 'APPROVE' as const,
      rationale: 'LGTM',
      wasUseful: true,
      reviewerId: reviewer,
      actorId,
      actorEmail: 'reviewer@example.com',
    };

    const results = await Promise.allSettled([
      svcA.decide(queueId, input),
      svcB.decide(queueId, input),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(QueueStateError);

    const decisionRows = await testDb.db.select().from(decisions);
    expect(decisionRows).toHaveLength(1);
    expect(decisionRows[0]?.reviewer_id).toBe(reviewer);

    const queueRows = await testDb.db
      .select({ status: reviewQueue.status })
      .from(reviewQueue)
      .where(eq(reviewQueue.id, queueId));
    expect(queueRows[0]?.status).toBe(ReviewQueueStatus.Decided);

    // The task transition is driven exactly once (the loser never reaches step 3).
    expect(transitionSpy).toHaveBeenCalledTimes(1);
  });
});
