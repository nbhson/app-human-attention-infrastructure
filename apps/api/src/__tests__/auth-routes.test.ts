/**
 * Auth route integration test (day-01 §3.4) — the full OIDC flow against a mock
 * IdP. Drives the real Fastify hook + routes over a minimal container wired to
 * an isolated test DB, so it exercises exactly the request path a browser would.
 */

import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, MockOidcProvider, SessionService } from '@harness/auth';
import { sessions, users } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { Container, TOKENS } from '@harness/di';

import { registerAuthHook } from '../auth.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { clearRateLimits } from '../rate-limit.js';

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
  clearRateLimits(); // module-level buckets must not leak between cases
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

  it('login is rate-limited: 30 per minute per IP, then 429', async () => {
    const app = buildApp();
    // The sensitive bucket (30/min, shared with decide/retry) guards the
    // unauthenticated login surface too — a flood must stop at the edge
    // instead of hammering the IdP and growing pendingLogins.
    for (let i = 0; i < 30; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/api/auth/login' });
      expect(res.statusCode).toBe(302);
    }
    const limited = await app.inject({ method: 'GET', url: '/api/auth/login' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: expect.stringContaining('rate limited') });
  });

  describe('mock-mode callback host derivation (allowlist)', () => {
    // The callback URL is the mock login's 302 Location (the mock IdP echoes
    // `redirectUri` back with a code + state), so the derived host is directly
    // observable there.
    async function loginLocation(app: ReturnType<typeof buildApp>): Promise<URL> {
      const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
      expect(login.statusCode).toBe(302);
      return new URL(login.headers.location!);
    }

    let saved: Record<string, string | undefined>;
    beforeEach(() => {
      saved = {
        OIDC_MOCK: process.env.OIDC_MOCK,
        OIDC_MOCK_ALLOWED_HOSTS: process.env.OIDC_MOCK_ALLOWED_HOSTS,
        APP_URL: process.env.APP_URL,
      };
      process.env.OIDC_MOCK = 'true';
      process.env.APP_URL = 'http://app-default.test';
      delete process.env.OIDC_MOCK_ALLOWED_HOSTS;
    });
    afterEach(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('an allowlisted Origin host is honoured (LAN/Vite proxy case)', async () => {
      const app = buildApp();
      const location = await loginLocation(app);
      const withOrigin = await app.inject({
        method: 'GET',
        url: '/api/auth/login',
        headers: { origin: 'http://localhost:5174' },
      });
      const direct = new URL(withOrigin.headers.location!);
      expect(`${direct.origin}${direct.pathname}`).toBe('http://localhost:5174/api/auth/callback');
      // Sanity: without the Origin header the injected Host (localhost, on the
      // default allowlist) is what drives the derivation.
      expect(`${location.origin}${location.pathname}`).toBe('http://localhost/api/auth/callback');
    });

    it('a non-allowlisted Origin host falls back to the APP_URL default (open-redirect guard)', async () => {
      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/login',
        // Host must be unlisted too — the injected default (localhost) would
        // otherwise be the allowlisted fallback.
        headers: { origin: 'http://evil.example.com', host: 'evil.example.com' },
      });
      const location = new URL(res.headers.location!);
      expect(`${location.origin}${location.pathname}`).toBe('http://app-default.test/api/auth/callback');
    });

    it('OIDC_MOCK_ALLOWED_HOSTS can admit an extra (LAN) host', async () => {
      process.env.OIDC_MOCK_ALLOWED_HOSTS = 'localhost,127.0.0.1,192.168.1.10';
      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/login',
        headers: { origin: 'http://192.168.1.10:5174' },
      });
      const location = new URL(res.headers.location!);
      expect(`${location.origin}${location.pathname}`).toBe('http://192.168.1.10:5174/api/auth/callback');
    });

    it('a non-localhost X-Forwarded-Host defaults to https, localhost to http (scheme fix)', async () => {
      process.env.OIDC_MOCK_ALLOWED_HOSTS = 'localhost,127.0.0.1,api.tunnel.test';
      const app = buildApp();
      const tunnel = await app.inject({
        method: 'GET',
        url: '/api/auth/login',
        headers: { host: 'api.tunnel.test' },
      });
      expect(`${new URL(tunnel.headers.location!).origin}${new URL(tunnel.headers.location!).pathname}`).toBe(
        'https://api.tunnel.test/api/auth/callback',
      );
      const local = await app.inject({
        method: 'GET',
        url: '/api/auth/login',
        headers: { host: '127.0.0.1:3000' },
      });
      expect(`${new URL(local.headers.location!).origin}${new URL(local.headers.location!).pathname}`).toBe(
        'http://127.0.0.1:3000/api/auth/callback',
      );
    });

    it('a disallowed X-Forwarded-Host falls back to the APP_URL default', async () => {
      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/login',
        headers: { host: 'evil.example.com:8080' },
      });
      const location = new URL(res.headers.location!);
      expect(`${location.origin}${location.pathname}`).toBe('http://app-default.test/api/auth/callback');
    });
  });
});
