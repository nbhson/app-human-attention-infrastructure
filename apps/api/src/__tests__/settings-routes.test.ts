/**
 * Settings route integration test (Phase 3 day-02 §3.4) — the ADMIN-guarded
 * provider list/toggle surface over the MCP registry + `provider_configs` mirror.
 *
 * Asserts the security boundary this day exists to enforce: a token *value*
 * never crosses the HTTP surface. `GET` returns only the last-4 `tokenHint`; the
 * response body must not contain the injected secrets. `PUT` persists `enabled`
 * (and the redacted hint) while leaving the registry config untouched.
 */

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, MockOidcProvider, SessionService } from '@harness/auth';
import { eventLog, providerConfigs, sessions, users } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { Container, TOKENS } from '@harness/di';
import { newUserID, Role } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import { McpServerRegistryImpl, parseMcpConfig } from '@harness/mcp';

import { registerAuthHook } from '../auth.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerSettingsRoutes } from '../routes/settings.js';

const SCHEMA = 'harness_test_settings_routes';
const SECRET = 'test-secret-that-is-long-enough-for-hs256';
const SUB = 'mock|principal';
const USER_ID = newUserID();

// Fake credentials that must never appear in any HTTP response body.
const GITHUB_SECRET = 'gh_abcdef1234567890';
const JIRA_SECRET = 'jira-secret-token';

const ENV: Record<string, string> = {
  GITHUB_TOKEN: GITHUB_SECRET,
  JIRA_TOKEN: JIRA_SECRET,
};

const CONFIG = parseMcpConfig(
  JSON.stringify({
    servers: {
      github: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@github/mcp-server'],
        tokenEnv: 'GITHUB_TOKEN',
      },
      jira: { transport: 'sse', url: 'https://mcp.atlassian.com/sse', tokenEnv: 'JIRA_TOKEN' },
    },
  }),
  ENV,
);

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // FK order: event_log.actor_id and sessions.user_id both reference users.
  await testDb.db.delete(eventLog);
  await testDb.db.delete(sessions);
  await testDb.db.delete(providerConfigs);
  await testDb.db.delete(users);
});

async function seedUser(roles: readonly Role[]): Promise<void> {
  await testDb.db.insert(users).values({
    id: USER_ID,
    oidc_sub: SUB,
    email: 'principal@example.com',
    display_name: 'Principal',
    roles: [...roles],
  });
}

function buildApp() {
  const container = new Container();
  const registry = new McpServerRegistryImpl(CONFIG, ENV);

  container.register(TOKENS.EventBus, () => new InProcessEventBus());
  container.register(TOKENS.Db, () => testDb.db);
  container.register(TOKENS.McpServerRegistry, () => registry);
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
  registerSettingsRoutes(app, container);
  return { app, registry };
}

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

describe('settings provider routes (guarded, day-02)', () => {
  it('401 with no credential', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/settings/providers' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('403 for a REVIEWER (day-02 guard)', async () => {
    await seedUser([Role.Operate, Role.Reviewer]);
    const { app } = buildApp();
    const cookie = await loginCookie(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/providers',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET returns redacted hints, never the token values', async () => {
    await seedUser([Role.Admin]);
    const { app } = buildApp();
    const cookie = await loginCookie(app);

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/providers',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    const raw = res.body;
    expect(body.providers).toHaveLength(2);
    expect(body.providers[0]).toMatchObject({
      name: 'github',
      kind: 'git',
      providerType: 'github',
      transport: 'stdio',
      tokenHint: '7890',
      enabled: true,
    });
    expect(body.providers[1]).toMatchObject({
      name: 'jira',
      kind: 'ticket',
      providerType: 'jira',
      transport: 'sse',
      tokenHint: 'oken',
      enabled: true,
    });

    // The boundary this day enforces: the values never leave the process.
    expect(raw).not.toContain(GITHUB_SECRET);
    expect(raw).not.toContain(JIRA_SECRET);
    await app.close();
  });

  it('PUT toggles enabled and persists only the redacted hint', async () => {
    await seedUser([Role.Admin]);
    const { app } = buildApp();
    const cookie = await loginCookie(app);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings/providers',
      headers: { cookie },
      payload: { providers: { github: false } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain(GITHUB_SECRET);

    // The display mirror now records the toggle + a redacted handle.
    const rows = await testDb.db.select().from(providerConfigs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'git',
      provider_type: 'github',
      token_redacted: '7890',
      enabled: false,
    });
    expect(rows[0]!.id).toBe('provider:git:github');

    // A follow-up GET reflects the mirrored state.
    const get = await app.inject({
      method: 'GET',
      url: '/api/settings/providers',
      headers: { cookie },
    });
    const github = get.json().providers.find((p: { name: string }) => p.name === 'github') as {
      enabled: boolean;
    };
    expect(github.enabled).toBe(false);
    await app.close();
  });

  it('PUT rejects an unknown provider name', async () => {
    await seedUser([Role.Admin]);
    const { app } = buildApp();
    const cookie = await loginCookie(app);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/providers',
      headers: { cookie },
      payload: { providers: { bitbucket: false } },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
