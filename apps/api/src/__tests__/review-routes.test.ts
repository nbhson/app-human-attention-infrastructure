/**
 * Review route integration test (day-22 §3) — the HTTP surface over a real
 * `ReviewService` (real DB + bus; the two cross-engine seams are spies, as in the
 * package test). Seeds one queued item, then drives the endpoints with
 * `app.inject` and asserts both status codes and seam side-effects.
 */

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  agentRuns,
  artifacts,
  assessmentFeedback,
  assessments,
  changes,
  decisions,
  projects,
  reviewQueue,
  tasks,
} from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import {
  newAgentRunID,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newProjectID,
  newReviewQueueItemID,
  newReviewerID,
  newTaskID,
  ReviewQueueStatus,
  TaskStatus,
} from '@harness/domain';
import type { ReviewQueueItemID } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import { ReviewService } from '@harness/review';
import type { FeedbackReporter, TaskTransition } from '@harness/review';

import { registerReviewRoutes } from '../routes/review.js';

const SCHEMA = 'harness_test_review_routes';

let testDb: TestDb;
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

  service = new ReviewService(
    testDb.db,
    new InProcessEventBus(),
    { transitionTask: transitionSpy } as TaskTransition,
    { reportAssessmentFeedback: reportSpy } as FeedbackReporter,
  );

  await testDb.db.delete(decisions);
  await testDb.db.delete(assessmentFeedback);
  await testDb.db.delete(reviewQueue);
  await testDb.db.delete(assessments);
  await testDb.db.delete(changes);
  await testDb.db.delete(artifacts);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
});

function buildApp() {
  const app = Fastify({ logger: false });
  registerReviewRoutes(app, service);
  return app;
}

/** Seed one QUEUED item and return its queue id (raw string). */
async function seedQueuedItem(): Promise<ReviewQueueItemID> {
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
  await db
    .insert(agentRuns)
    .values({ id: agentRunId, task_id: taskId, status: 'COMPLETED', max_steps: 10 });
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

  return queueId;
}

describe('review routes', () => {
  it('GET /api/review/queue lists seeded items', async () => {
    const queueId = await seedQueuedItem();
    const app = buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/review/queue' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; status: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: queueId, status: 'QUEUED' });
    await app.close();
  });

  it('GET /api/review/queue/:id returns detail; unknown id is 404', async () => {
    const queueId = await seedQueuedItem();
    const app = buildApp();

    const ok = await app.inject({ method: 'GET', url: `/api/review/queue/${queueId}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: queueId, label: 'HIGH', taskTitle: 'Do the thing' });

    const missing = await app.inject({
      method: 'GET',
      url: `/api/review/queue/${newReviewQueueItemID()}`,
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('POST claim assigns a reviewer; a second claim is 409', async () => {
    const queueId = await seedQueuedItem();
    const app = buildApp();
    const reviewer = newReviewerID();

    const first = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${queueId}/claim`,
      payload: { reviewerId: String(reviewer) },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ claimedBy: reviewer });

    const second = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${queueId}/claim`,
      payload: { reviewerId: String(newReviewerID()) },
    });
    expect(second.statusCode).toBe(409);
    await app.close();
  });

  it('POST decide records the decision and drives the transition seam', async () => {
    const queueId = await seedQueuedItem();
    const app = buildApp();
    const reviewer = newReviewerID();

    await app.inject({
      method: 'POST',
      url: `/api/review/queue/${queueId}/claim`,
      payload: { reviewerId: String(reviewer) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${queueId}/decide`,
      payload: {
        decision: 'APPROVE',
        rationale: 'LGTM',
        wasUseful: true,
        reviewerId: String(reviewer),
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'DECIDED' });
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('POST drop with a blank rationale is 400', async () => {
    const queueId = await seedQueuedItem();
    const app = buildApp();

    const res = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${queueId}/drop`,
      payload: { rationale: '   ', reviewerId: String(newReviewerID()) },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
