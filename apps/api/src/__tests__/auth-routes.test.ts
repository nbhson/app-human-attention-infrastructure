/**
 * Auth route integration test (day-01 §3.4) — the full OIDC flow against a mock
 * IdP. Drives the real Fastify hook + routes over a minimal container wired to
 * an isolated test DB, so it exercises exactly the request path a browser would.
 */

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, MockOidcProvider, SessionService } from '@harness/auth';
import { sessions, users } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { Container, TOKENS } from '@harness/di';

import { registerAuthHook } from '../auth.js';
import { registerAuthRoutes } from '../routes/auth.js';

const SCHEMA = 'harness_test_auth_routes';
const SECRET = 'test-secret-that-is-long-enough-for-hs256';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await testDb.db.delete(sessions);
  await testDb.db.delete(users);
});

/** A minimal container with just the three auth tokens over the test DB. */
function buildApp(demoName = 'Demo Reviewer') {
  const container = new Container();
  container.register(
    TOKENS.OidcProvider,
    () => new MockOidcProvider({ sub: 'mock|demo', email: 'demo@example.com', name: demoName }),
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
  return app;
}

/** Complete a mock login and return the resulting session cookie. */
async function loginCookie(app: ReturnType<typeof buildApp>): Promise<string> {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
  expect(login.statusCode).toBe(302);
  const location = new URL(login.headers.location!);
  const state = location.searchParams.get('state')!;
  const code = location.searchParams.get('code')!;

  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${code}&state=${state}`,
  });
  expect(callback.statusCode).toBe(200);
  const setCookie = callback.headers['set-cookie']!.toString();
  return setCookie.split(';')[0]!; // "sid=..."
}

describe('auth routes', () => {
  it('GET /api/auth/session without a credential is 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(res.statusCode).toBe(401);
  });

  it('full mock login returns a session cookie + access JWT, and /session resolves the user', async () => {
    const app = buildApp();
    const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const location = new URL(login.headers.location!);
    const callbackRes = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=${location.searchParams.get('code')}&state=${location.searchParams.get('state')}`,
    });
    expect(callbackRes.statusCode).toBe(200);

    const body = callbackRes.json();
    expect(body.token).toBeTypeOf('string');
    expect(body.user.sub).toBe('mock|demo');
    expect(body.user.roles).toContain('OPERATOR');

    const cookie = callbackRes.headers['set-cookie']!.toString().split(';')[0];
    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.email).toBe('demo@example.com');
  });

  it('logout revokes the session: the old cookie no longer authenticates', async () => {
    const app = buildApp();
    const cookie = await loginCookie(app);

    const beforeLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(beforeLogout.statusCode).toBe(200);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);

    // A request that still *sends* the revoked sid must now be 401.
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('complete login persists a user + session row', async () => {
    const app = buildApp();
    await loginCookie(app);
    const userRows = await testDb.db.select().from(users);
    const sessionRows = await testDb.db.select().from(sessions);
    expect(userRows).toHaveLength(1);
    expect(userRows[0]!.oidc_sub).toBe('mock|demo');
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]!.revoked_at).toBeNull();
  });
});
