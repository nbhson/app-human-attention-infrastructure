/**
 * Review-decision route integration test (Phase 3 day-09).
 *
 * Exercises the real `POST /api/reviews/:id/decision` handler against a real
 * Postgres schema, with a fake `WriteBackService` recording every emitted intent,
 * driven through a real authenticated session (day-02 §3.5 — the review slice is
 * now guarded). This proves the day-09 acceptance criteria at the HTTP surface,
 * plus the authorization boundary the guard enforces:
 *
 *  - APPROVE + ON  → a COMMENT and a STATUS intent are emitted.
 *  - REJECT  + ON  → a COMMENT and a STATUS (failure) intent are emitted.
 *  - any OFF (missing flag or unarmed ceiling) → zero intents, `writeback: false`.
 *  - `WRITEBACK_ENABLED=0` (explicit off) defeats a request-level ON.
 *  - the decision row persists its effective toggle for audit.
 *  - no credential → 401; an OPERATOR-only principal → 403 + `authz.decision_denied`.
 */

import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { AuthService, MockOidcProvider, SessionService } from '@harness/auth';
import { Container, TOKENS } from '@harness/di';
import { EventType, newDecisionID, newReviewReportID, newUserID, Role, WritebackAction } from '@harness/domain';
import type { WriteBackIntent } from '@harness/domain';
import { reviewDecisions, reviewReports, sessions, users, writebackLog } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { InProcessEventBus } from '@harness/event-bus';
import type { WriteBackService } from '@harness/writeback';
import type { ReviewIngestService } from '../services/review-ingest.js';

import { registerAuthHook } from '../auth.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerReviewIngestRoutes } from '../routes/reviews.js';

const SCHEMA = 'harness_test_review_decision';
const SECRET = 'test-secret-that-is-long-enough-for-hs256';
const REVIEWER_SUB = 'mock|reviewer';
const REVIEWER_USER_ID = newUserID();

let testDb: TestDb;
const reportId = newReviewReportID();

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // FK order: writeback_log → review_decisions → review_reports; sessions → users.
  await testDb.db.delete(writebackLog);
  await testDb.db.delete(reviewDecisions);
  await testDb.db.delete(reviewReports);
  await testDb.db.delete(sessions);
  await testDb.db.delete(users);

  await testDb.db.insert(reviewReports).values({
    id: reportId,
    pr_url: 'https://github.com/acme/api/pull/42',
    pr_number: 42,
    repo: 'github.com/acme/api',
    pr_title: 'Fix the thing',
    ai_provider: 'anthropic',
    model: 'claude-sonnet-4',
    summary: 'Looks good',
    overall_verdict: 'APPROVE',
    pr_payload: {},
  });

  delete process.env.WRITEBACK_ENABLED;
});

afterEach(() => {
  delete process.env.WRITEBACK_ENABLED;
});

interface Harness {
  app: ReturnType<typeof Fastify>;
  intents: WriteBackIntent[];
  cookie: string;
  bus: InProcessEventBus;
}

/** Pre-seed the principal's `users` row so login preserves the desired roles. */
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
async function loginCookie(app: ReturnType<typeof Fastify>): Promise<string> {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const location = new URL(login.headers.location!);
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${location.searchParams.get('code')}&state=${location.searchParams.get('state')}`,
  });
  expect(callback.statusCode).toBe(200);
  return callback.headers['set-cookie']!.toString().split(';')[0]!; // "sid=..."
}

/**
 * Wire auth + the guarded decision route over the test DB with a fake
 * write-back service recording intents. The caller's roles come from the seeded
 * `users` row at login, not from here.
 */
async function build(roles: readonly Role[] = [Role.Operate, Role.Reviewer]): Promise<Harness> {
  await seedUser(roles);

  const intents: WriteBackIntent[] = [];
  const fakeWriteback: WriteBackService = {
    write: async (intent) => {
      intents.push(intent);
      return { ok: true, intentId: intent.id };
    },
  };

  const bus = new InProcessEventBus();
  const container = new Container();
  container.register(TOKENS.EventBus, () => bus);
  container.register(TOKENS.Db, () => testDb.db);
  container.register(TOKENS.WriteBackService, () => fakeWriteback);
  container.register(TOKENS.ReviewIngestService, () => ({}) as ReviewIngestService);
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

  const app = Fastify({ logger: false });
  registerAuthHook(app, container);
  registerAuthRoutes(app, container);
  registerReviewIngestRoutes(app, container, undefined);

  const cookie = await loginCookie(app);
  return { app, intents, cookie, bus };
}

async function decisionRows() {
  return testDb.db.select().from(reviewDecisions).where(eq(reviewDecisions.report_id, reportId));
}

describe('POST /api/reviews/:id/decision (day-09 write-back toggle)', () => {
  it('401 with no credential and writes nothing', async () => {
    const { app, intents } = await build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      payload: { decision: 'APPROVE', rationale: 'LGTM' },
    });

    expect(res.statusCode).toBe(401);
    expect(intents).toHaveLength(0);
    expect(await decisionRows()).toHaveLength(0);

    await app.close();
  });

  it('403 for an OPERATOR-only principal (emits authz.decision_denied)', async () => {
    const { app, intents, bus, cookie } = await build([Role.Operate]);
    const denied: unknown[] = [];
    bus.subscribe(EventType.AuthzDecisionDenied, (event) => {
      denied.push(event);
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie },
      payload: { decision: 'APPROVE', rationale: 'LGTM' },
    });

    expect(res.statusCode).toBe(403);
    expect(intents).toHaveLength(0);
    expect(await decisionRows()).toHaveLength(0);
    const payload = (denied[0] as { payload: { roles_required: string[] } } | undefined)?.payload;
    expect(payload?.roles_required).toContain(Role.Reviewer);

    await app.close();
  });

  it('OFF (missing flag, at rest) records writeback:false and emits nothing', async () => {
    const { app, intents, cookie } = await build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie },
      payload: { decision: 'APPROVE', rationale: 'LGTM' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { writeback: false };
    expect(body.writeback).toBe(false);
    expect(intents).toHaveLength(0);

    const rows = await decisionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: 'APPROVE', writeback_enabled: false });

    await app.close();
  });

  it('ON + APPROVE emits COMMENT + STATUS(success) and records writeback:true', async () => {
    process.env.WRITEBACK_ENABLED = '1';
    const { app, intents, cookie } = await build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie },
      payload: { decision: 'APPROVE', rationale: 'LGTM', writeback: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      decisionId: string;
      writeback: { comment: { ok: boolean }; status: { ok: boolean } };
    };
    expect(body.writeback.comment.ok).toBe(true);
    expect(body.writeback.status.ok).toBe(true);

    expect(intents).toHaveLength(2);
    expect(intents.map((i) => i.action)).toEqual([WritebackAction.Comment, WritebackAction.Status]);
    expect(intents[0]?.state).toBeUndefined();
    expect(intents[1]?.state).toBe('success');
    expect(intents[0]?.decisionId).toBe(body.decisionId);
    expect(intents[1]?.decisionId).toBe(body.decisionId);

    const rows = await decisionRows();
    expect(rows[0]).toMatchObject({ decision: 'APPROVE', writeback_enabled: true });

    await app.close();
  });

  it('WRITEBACK_ENABLED=0 (explicit off) defeats a request-level ON', async () => {
    // An operator opts the deployment out with WRITEBACK_ENABLED=0 — the ceiling
    // is off even though the request asks for ON.
    process.env.WRITEBACK_ENABLED = '0';
    const { app, intents, cookie } = await build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie },
      payload: { decision: 'APPROVE', writeback: true },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { writeback: false }).writeback).toBe(false);
    expect(intents).toHaveLength(0);

    const rows = await decisionRows();
    expect(rows[0]).toMatchObject({ writeback_enabled: false });

    await app.close();
  });

  it('ON + REJECT emits COMMENT + STATUS(failure)', async () => {
    process.env.WRITEBACK_ENABLED = '1';
    const { app, intents, cookie } = await build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie },
      payload: { decision: 'REJECT', rationale: 'breaks CI', writeback: true },
    });

    expect(res.statusCode).toBe(200);
    expect(intents).toHaveLength(2);
    expect(intents[0]?.action).toBe(WritebackAction.Comment);
    expect(intents[0]?.body).toContain('## ❌ PR Review: REJECTED');
    expect(intents[0]?.body).toContain('breaks CI');
    expect(intents[1]?.action).toBe(WritebackAction.Status);
    expect(intents[1]?.state).toBe('failure');

    await app.close();
  });

  it('ON + REQUEST_CHANGES emits nothing external', async () => {
    process.env.WRITEBACK_ENABLED = '1';
    const { app, intents, cookie } = await build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie },
      payload: { decision: 'REQUEST_CHANGES', writeback: true },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { writeback: { emitted: number } }).writeback.emitted).toBe(0);
    expect(intents).toHaveLength(0);

    // The toggle is still recorded (ON, but REQUEST_CHANGES never writes).
    const rows = await decisionRows();
    expect(rows[0]).toMatchObject({ decision: 'REQUEST_CHANGES', writeback_enabled: true });

    await app.close();
  });

  it('rejects an unknown decision with 400 and writes no row', async () => {
    const { app, intents, cookie } = await build();

    const res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie },
      payload: { decision: 'WHATEVER' },
    });

    expect(res.statusCode).toBe(400);
    expect(intents).toHaveLength(0);
    expect(await decisionRows()).toHaveLength(0);

    await app.close();
  });
});

describe('GET /api/reviews (list with pending filter)', () => {
  it('lists the seeded report as undecided, then hides it once a decision exists', async () => {
    const { app, cookie } = await build();

    let res = await app.inject({ method: 'GET', url: '/api/reviews', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    let list = res.json() as Array<{ id: string; decided: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: reportId, decided: false });

    res = await app.inject({ method: 'GET', url: '/api/reviews?pending=1', headers: { cookie } });
    list = res.json() as Array<{ id: string; decided: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(reportId);

    // Record a decision: the report flips to decided and drops out of ?pending=1.
    await testDb.db.insert(reviewDecisions).values({
      id: newDecisionID(),
      report_id: reportId,
      decision: 'APPROVE',
      writeback_enabled: false,
    });

    res = await app.inject({ method: 'GET', url: '/api/reviews', headers: { cookie } });
    list = res.json() as Array<{ id: string; decided: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: reportId, decided: true });

    res = await app.inject({ method: 'GET', url: '/api/reviews?pending=1', headers: { cookie } });
    const pendingAfter = res.json() as Array<{ id: string }>;
    expect(pendingAfter).toHaveLength(0);

    await app.close();
  });

  it('returns 401 without a credential', async () => {
    const { app } = await build();

    const res = await app.inject({ method: 'GET', url: '/api/reviews' });
    expect(res.statusCode).toBe(401);

    await app.close();
  });
});
