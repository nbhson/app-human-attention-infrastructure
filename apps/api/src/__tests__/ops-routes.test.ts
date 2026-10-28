/**
 * Ops endpoint integration test (day-27 §2.4) — a real test DB behind the two
 * `/api/ops/*` endpoints. No container is needed here: the routes take a
 * resolved `DrizzleDB`, so this drives them exactly as `buildApp` does.
 */

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, MockOidcProvider, SessionService } from '@harness/auth';
import {
  agentRuns,
  artifacts,
  assessments,
  changes,
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
import { InProcessEventBus } from '@harness/event-bus';

import { registerAuthHook } from '../auth.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerOpsRoutes } from '../routes/ops.js';

const SCHEMA = 'harness_test_ops_routes';
const SECRET = 'test-secret-that-is-long-enough-for-hs256';
const SUB = 'mock|principal';
const USER_ID = newUserID();

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  const db = testDb.db;
  await db.delete(eventLog);
  await db.delete(sessions);
  await db.delete(reviewQueue);
  await db.delete(assessments);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(tasks);
  await db.delete(projects);
  await db.delete(users);
});

/** Seed the single principal the mock login resolves to, with the given roles. */
async function seedUser(roles: readonly Role[]): Promise<void> {
  await testDb.db.insert(users).values({
    id: USER_ID,
    oidc_sub: SUB,
    email: 'principal@example.com',
    display_name: 'Principal',
    roles: [...roles],
  });
}

/** Build the app with identity hook + ops routes over a test container. */
function buildApp() {
  const container = new Container();
  container.register(TOKENS.Db, () => testDb.db);
  container.register(TOKENS.EventBus, () => new InProcessEventBus());
  container.register(
    TOKENS.OidcProvider,
    () => new MockOidcProvider({ sub: SUB, email: 'principal@example.com', name: 'Principal' }),
  );
  container.register(TOKENS.SessionService, () => new SessionService(testDb.db));
  container.register(
    TOKENS.AuthService,
    (c) =>
      new AuthService(testDb.db, c.resolve<SessionService>(TOKENS.SessionService), {
        jwtSecret: SECRET,
      }),
  );

  const app = Fastify({ logger: false });
  registerAuthHook(app, container);
  registerAuthRoutes(app, container);
  registerOpsRoutes(app, container);
  return app;
}

/** Complete a mock login and return the `sid` cookie. */
async function loginCookie(app: ReturnType<typeof buildApp>): Promise<string> {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const location = new URL(login.headers.location!);
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${location.searchParams.get('code')}&state=${location.searchParams.get('state')}`,
  });
  expect(callback.statusCode).toBe(200);
  return callback.headers['set-cookie']!.toString().split(';')[0]!;
}

/** Insert a project and return its id (each test needs at least one). */
async function seedProject(name: string): Promise<string> {
  const id = newProjectID();
  await testDb.db.insert(projects).values({ id, name, repo_path: `/tmp/${name}` });
  return id;
}

/** Insert a task with an explicit state (optionally stale for the orphan alarm). */
async function insertTask(projectId: string, state: string, staleUpdatedAt = false): Promise<void> {
  await testDb.db.insert(tasks).values({
    id: newTaskID(),
    project_id: projectId,
    title: `task-${state}`,
    state,
    idempotency_key: newTaskID(),
    ...(staleUpdatedAt ? { updated_at: new Date(Date.now() - 20 * 60_000) } : {}),
  });
}

describe('ops routes', () => {
  it('GET /api/ops/health reports DB liveness without a credential', async () => {
    const projectId = await seedProject('ops');
    await insertTask(projectId, TaskStatus.Queued);
    const app = buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/ops/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await app.close();
  });

  it('GET /api/ops/metrics is 401 without a credential', async () => {
    const projectId = await seedProject('ops');
    await insertTask(projectId, TaskStatus.Queued);
    const app = buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/ops/metrics' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/ops/metrics returns state counts, queue depth, and orphan count', async () => {
    const projectId = await seedProject('ops');
    await insertTask(projectId, TaskStatus.Queued);
    await insertTask(projectId, TaskStatus.Executing); // fresh — not an orphan
    await insertTask(projectId, TaskStatus.Executing, true); // orphan (20 min stale)
    await insertTask(projectId, TaskStatus.Completed);

    // One QUEUED review-queue item (needs the full assessment chain).
    const db = testDb.db;
    const reviewTaskId = newTaskID();
    const agentRunId = newAgentRunID();
    const artifactId = newArtifactID();
    const changeId = newChangeID();
    const assessmentId = newAssessmentID();
    await db.insert(tasks).values({
      id: reviewTaskId,
      project_id: projectId,
      title: 'review task',
      state: TaskStatus.AwaitingReview,
      idempotency_key: newTaskID(),
    });
    await db.insert(agentRuns).values({ id: agentRunId, task_id: reviewTaskId, status: 'COMPLETED', max_steps: 10 });
    await db.insert(artifacts).values({
      id: artifactId,
      project_id: projectId,
      file_path: 'src/review.ts',
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
      id: newReviewQueueItemID(),
      task_id: reviewTaskId,
      assessment_id: assessmentId,
      action: 'REVIEW_REQUIRED',
      policy_version: 1,
      rule_id: 'r1',
      position: 1,
      status: ReviewQueueStatus.Queued,
    });

    // Metrics now requires auth — login as an OPERATOR first.
    await seedUser([Role.Operate]);
    const app = buildApp();
    const cookie = await loginCookie(app);
    const res = await app.inject({ method: 'GET', url: '/api/ops/metrics', headers: { cookie } });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tasksByState: Record<string, number>;
      reviewQueueDepth: number;
      orphanedTasks: number;
    };
    expect(body.tasksByState.QUEUED).toBe(1);
    expect(body.tasksByState.EXECUTING).toBe(2);
    expect(body.tasksByState.COMPLETED).toBe(1);
    expect(body.tasksByState.AWAITING_REVIEW).toBe(1);
    expect(body.reviewQueueDepth).toBe(1);
    expect(body.orphanedTasks).toBe(1);
    await app.close();
  });
});
