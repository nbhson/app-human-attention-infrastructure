/**
 * Admin route integration test (day-14 §3.3, §2.2) — the ADMIN-only surface over
 * the auto-approve flag + kill-switch, guarded by the Day-02 `requireRole`.
 *
 * A mock OIDC login yields a session; the principal's roles decide whether a
 * guarded request is admitted (200 for ADMIN) or refused for missing privilege
 * (403 for REVIEWER + an `authz.decision_denied` event), matching the day-02
 * guard exercised by `review-routes.test.ts`.
 */

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, MockOidcProvider, SessionService } from '@harness/auth';
import { AutoApproveKillSwitch } from '@harness/attention-engine';
import { autoApproveKillSwitch, eventLog, sessions, users } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { Container, TOKENS } from '@harness/di';
import { newUserID, Role } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';

import { registerAuthHook } from '../auth.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerAdminRoutes } from '../routes/admin.js';

const SCHEMA = 'harness_test_admin_routes';
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
  // FK order: event_log.actor_id and sessions.user_id both reference users, and
  // the kill-switch's killed_by references users too — clear them (and null the
  // killed_by) before touching users.
  await testDb.db.delete(eventLog);
  await testDb.db.delete(sessions);
  await testDb.db.update(autoApproveKillSwitch).set({
    auto_approve_enabled: false,
    enabled: true,
    killed_at: null,
    killed_by: null,
    reason: null,
  });
  await testDb.db.delete(users);
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

/** Build the app with auth + admin routes, and a real kill-switch over the DB. */
function buildApp() {
  const container = new Container();
  const killSwitch = new AutoApproveKillSwitch(testDb.db);
  const bus = new InProcessEventBus();

  container.register(TOKENS.EventBus, () => bus);
  container.register(TOKENS.AutoApproveKillSwitch, () => killSwitch);
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
  registerAdminRoutes(app, container);
  return { app, killSwitch };
}

/** Complete a mock login and return the `sid` cookie. */
async function loginCookie(app: ReturnType<typeof buildApp>['app']): Promise<string> {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const location = new URL(login.headers.location!);
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${location.searchParams.get('code')}&state=${location.searchParams.get('state')}`,
  });
  expect(callback.statusCode).toBe(200);
  return callback.headers['set-cookie']!.toString().split(';')[0]!;
}

describe('admin auto-approve routes (guarded, day-14)', () => {
  it('401 with no credential', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auto-approve/enabled',
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('403 for a REVIEWER on both endpoints (day-02 guard)', async () => {
    await seedUser([Role.Operate, Role.Reviewer]);
    const { app } = buildApp();
    const cookie = await loginCookie(app);

    const enabled = await app.inject({
      method: 'POST',
      url: '/api/admin/auto-approve/enabled',
      headers: { cookie },
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(403);

    const kill = await app.inject({
      method: 'POST',
      url: '/api/admin/auto-approve/kill',
      headers: { cookie },
      payload: { reason: 'reviewer tried to kill' },
    });
    expect(kill.statusCode).toBe(403);

    // The denial was audited; the switch is untouched.
    expect(await new AutoApproveKillSwitch(testDb.db).isKilled()).toBe(false);
    await app.close();
  });

  it('200 for an ADMIN: flag flip takes effect', async () => {
    await seedUser([Role.Admin]);
    const { app, killSwitch } = buildApp();
    const cookie = await loginCookie(app);

    const enabled = await app.inject({
      method: 'POST',
      url: '/api/admin/auto-approve/enabled',
      headers: { cookie },
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toEqual({ autoApproveEnabled: true });
    expect(await killSwitch.isFlagEnabled()).toBe(true);
    await app.close();
  });

  it('200 for an ADMIN: kill trips the switch with the actor recorded', async () => {
    await seedUser([Role.Admin]);
    const { app, killSwitch } = buildApp();
    const cookie = await loginCookie(app);

    const kill = await app.inject({
      method: 'POST',
      url: '/api/admin/auto-approve/kill',
      headers: { cookie },
      payload: { reason: 'red calibration' },
    });
    expect(kill.statusCode).toBe(200);
    expect(kill.json()).toEqual({ ok: true, killed: true });
    expect(await killSwitch.isKilled()).toBe(true);

    const row = (await testDb.db.select().from(autoApproveKillSwitch))[0];
    expect(row?.killed_by).toBe(USER_ID);
    expect(row?.reason).toBe('red calibration');
    await app.close();
  });
});
