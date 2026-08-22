/**
 * Review route integration test (day-22 §3, day-02 §3.5) — the HTTP surface over
 * a real `ReviewService` (real DB + bus; the two cross-engine seams are spies),
 * now guarded by `requireRole` and driven by a real authenticated session.
 *
 * A mock OIDC login yields a session, and the caller's roles decide whether a
 * guarded request is admitted (200), refused for missing identity (401), or
 * refused for missing privilege (403 + an `authz.decision_denied` event).
 */

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService, MockOidcProvider, SessionService } from '@harness/auth';
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
  sessions,
  tasks,
  users,
} from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { Container, TOKENS } from '@harness/di';
import {
  EventType,
  newAgentRunID,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newProjectID,
  newReviewQueueItemID,
  newTaskID,
  newUserID,
  ReviewQueueStatus,
  Role,
  TaskStatus,
} from '@harness/domain';
import type { ReviewQueueItemID } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import { ReviewService } from '@harness/review';
import type { FeedbackReporter, TaskTransition } from '@harness/review';

import { registerAuthHook } from '../auth.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerReviewRoutes } from '../routes/review.js';

const SCHEMA = 'harness_test_review_routes';
const SECRET = 'test-secret-that-is-long-enough-for-hs256';
const REVIEWER_SUB = 'mock|reviewer';
const REVIEWER_USER_ID = newUserID();

let testDb: TestDb;
let service: ReviewService;
let bus: InProcessEventBus;
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
  service = new ReviewService(
    testDb.db,
    bus,
    { transitionTask: transitionSpy } as TaskTransition,
    { reportAssessmentFeedback: reportSpy } as FeedbackReporter,
  );

  // Truncate in FK order (children before parents; users/sessions last as
  // decisions.actor_id now FKs to users).
  await testDb.db.delete(eventLog);
  await testDb.db.delete(decisions);
  await testDb.db.delete(assessmentFeedback);
  await testDb.db.delete(reviewQueue);
  await testDb.db.delete(assessments);
  await testDb.db.delete(changes);
  await testDb.db.delete(artifacts);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
  await testDb.db.delete(sessions);
  await testDb.db.delete(users);
});

/** Wire auth + guarded review routes over the test DB. Role comes from the
 * seeded `users` row at login, not from here. */
function buildApp() {
  const container = new Container();
  container.register(TOKENS.EventBus, () => bus);
  container.register(
    TOKENS.OidcProvider,
    () => new MockOidcProvider({ sub: REVIEWER_SUB, email: 'reviewer@example.com', name: 'Rev' }),
  );
  container.register(TOKENS.SessionService, () => new SessionService(testDb.db));
  container.register(
    TOKENS.AuthService,
    (c) =>
      new AuthService(testDb.db, c.resolve<SessionService>(TOKENS.SessionService), {
        jwtSecret: SECRET,
      }),
  );
  container.register(TOKENS.ReviewService, () => service);

  const app = Fastify({ logger: false });
  registerAuthHook(app, container);
  registerAuthRoutes(app, container);
  registerReviewRoutes(app, container);
  return app;
}

/** Pre-seed the reviewer's `users` row so login preserves the desired roles. */
async function seedUser(roles: readonly Role[]): Promise<void> {
  await testDb.db.insert(users).values({
    id: REVIEWER_USER_ID,
    oidc_sub: REVIEWER_SUB,
    email: 'reviewer@example.com',
    display_name: 'Rev',
    roles: [...roles],
  });
}

/** Complete a mock login and return the resulting `sid` cookie. */
async function loginCookie(app: ReturnType<typeof buildApp>): Promise<string> {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const location = new URL(login.headers.location!);
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${location.searchParams.get('code')}&state=${location.searchParams.get('state')}`,
  });
  expect(callback.statusCode).toBe(200);
  return callback.headers['set-cookie']!.toString().split(';')[0]!; // "sid=..."
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

describe('review routes (guarded, day-02)', () => {
  it('401 on a guarded route with no credential', async () => {
    const queueId = await seedQueuedItem();
    const app = buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/review/queue' });
    expect(res.statusCode).toBe(401);

    const claim = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${queueId}/claim`,
    });
    expect(claim.statusCode).toBe(401);
    await app.close();
  });

  it('a REVIEWER can list, claim, and decide; actor is written to the decision', async () => {
    await seedUser([Role.Operate, Role.Reviewer]);
    const queueId = await seedQueuedItem();
    const app = buildApp();
    const cookie = await loginCookie(app);

    const list = await app.inject({
      method: 'GET',
      url: '/api/review/queue',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { id: string }[])[0]).toMatchObject({ id: queueId, status: 'QUEUED' });

    const claim = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${queueId}/claim`,
      headers: { cookie },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({ claimedBy: REVIEWER_USER_ID });

    const decide = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${queueId}/decide`,
      headers: { cookie },
      payload: { decision: 'APPROVE', rationale: 'LGTM', wasUseful: true },
    });
    expect(decide.statusCode).toBe(200);
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledTimes(1);

    const rows = await testDb.db.select().from(decisions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: REVIEWER_USER_ID,
      actor_email: 'reviewer@example.com',
    });
    await app.close();
  });

  it('an OPERATOR is refused with 403 and emits authz.decision_denied', async () => {
    await seedUser([Role.Operate]); // no REVIEWER role
    const queueId = await seedQueuedItem();
    const app = buildApp();

    const cookie = await loginCookie(app);
    const seen: unknown[] = [];
    bus.subscribe(EventType.AuthzDecisionDenied, (event) => {
      seen.push(event);
    });

    const claim = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${queueId}/claim`,
      headers: { cookie },
    });
    expect(claim.statusCode).toBe(403);

    // The denial is audited, not silent.
    expect(seen).toHaveLength(1);
    const payload = seen[0] as { payload: { actor_id: string; roles_required: string[] } };
    expect(payload.payload.actor_id).toBe(REVIEWER_USER_ID);
    expect(payload.payload.roles_required).toContain(Role.Reviewer);
    await app.close();
  });

  it('a read-only OPERATOR can view queue detail', async () => {
    await seedUser([Role.Operate]);
    const queueId = await seedQueuedItem();
    const app = buildApp();

    const cookie = await loginCookie(app);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/review/queue/${queueId}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: queueId, label: 'HIGH' });
    await app.close();
  });
});
