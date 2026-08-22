/**
 * `AuthService` integration test (day-01 §3.5).
 *
 * Uses a *real* DrizzleDB against an isolated test schema (same `createTestDb`
 * pattern as every other package). A fake OIDC exchange is not needed here —
 * these tests drive `findOrCreateUser` / `issueAccessToken` / `validateAccessToken`
 * directly, which is the unit under test. The revocation-kills-a-valid-signature
 * case is the headline: a token whose signature is fine still fails once its
 * session is revoked.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { users } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { brand, DEFAULT_ROLES, Role } from '@harness/domain';
import type { OidcUserInfo } from '@harness/domain';

import { AuthService } from '../auth-service.js';
import { InvalidTokenError, SessionRevokedError } from '../errors.js';
import { SessionService } from '../session-service.js';

const SCHEMA = 'harness_test_auth_pkg';
const SECRET = 'test-secret-that-is-long-enough-for-hs256';

describe('AuthService', () => {
  let td: TestDb;
  let auth: AuthService;

  const alice: OidcUserInfo = {
    sub: 'auth0|u_alice_123',
    email: 'alice@example.com',
    name: 'Alice Reviewer',
  };

  beforeAll(async () => {
    td = await createTestDb(SCHEMA);
  });

  afterAll(async () => {
    await destroyTestDb(td, SCHEMA);
  });

  beforeEach(() => {
    auth = new AuthService(td.db, new SessionService(td.db), { jwtSecret: SECRET });
  });

  /** Log a user in end-to-end: provision → session → token. */
  async function login(userInfo: OidcUserInfo, ttlMs = 15 * 60_000) {
    const svc = new AuthService(td.db, new SessionService(td.db), {
      jwtSecret: SECRET,
      tokenTtlMs: ttlMs,
    });
    const user = await svc.findOrCreateUser(userInfo);
    const session = await svc.createSession(user.id);
    const token = await svc.issueAccessToken(user, session.id);
    return { svc, user, session, token };
  }

  it('find-or-create is idempotent on oidc_sub', async () => {
    const first = await auth.findOrCreateUser(alice);
    const second = await auth.findOrCreateUser(alice);
    expect(second.id).toBe(first.id);
    expect(second.oidcSub).toBe(alice.sub);
  });

  it('new users assume DEFAULT_ROLES (OPERATOR)', async () => {
    const user = await auth.findOrCreateUser(alice);
    expect(user.roles).toEqual(DEFAULT_ROLES);
  });

  it('upsert does not clobber roles on re-login', async () => {
    const user = await auth.findOrCreateUser(alice);
    // Promote the user to REVIEWER in the DB (as review authz does).
    await td.db
      .update(users)
      .set({ roles: [Role.Reviewer] })
      .where(eq(users.id, user.id));

    // Re-login must refresh display claims but not rewrite roles.
    const relogged = await auth.findOrCreateUser(alice);
    expect(relogged.roles).toEqual([Role.Reviewer]);
  });

  it('re-login refreshes email/display_name', async () => {
    const before = await auth.findOrCreateUser(alice);
    const renamed: OidcUserInfo = {
      ...alice,
      email: 'alice@new.example.com',
      name: 'Alice P. Reviewer',
    };
    const after = await auth.findOrCreateUser(renamed);
    expect(after.id).toBe(before.id);
    expect(after.email).toBe('alice@new.example.com');
    expect(after.displayName).toBe('Alice P. Reviewer');
  });

  it('a valid token resolves to the principal', async () => {
    const { token, user } = await login(alice);
    const ctx = await auth.validateAccessToken(token);
    expect(ctx.user.id).toBe(user.id);
    expect(ctx.user.oidcSub).toBe(alice.sub);
    expect(ctx.sid).toBeDefined();
  });

  it('validate rejects an expired token', async () => {
    const { token, user, session } = await login(alice, -1000); // past expiry
    await expect(auth.validateAccessToken(token)).rejects.toBeInstanceOf(InvalidTokenError);
    expect(user).toBeDefined();
    expect(session).toBeDefined();
  });

  it('validate rejects a token whose session was revoked (signature alone is not enough)', async () => {
    const { svc, token, session, user } = await login(alice);
    await svc.revokeSession(session.id);
    await expect(auth.validateAccessToken(token)).rejects.toBeInstanceOf(SessionRevokedError);
    expect(user).toBeDefined();
    expect(token).toBeTypeOf('string');
  });

  it('validate rejects a garbage token', async () => {
    await expect(auth.validateAccessToken('not.a.jwt')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('the token subject is the stable oidc sub, not the email', async () => {
    const { token, user } = await login(alice);
    // The JWT `sub` is the provider sub (never an email that could be re-assigned).
    const decoded = token.split('.')[1];
    const claims = JSON.parse(Buffer.from(decoded!, 'base64url').toString('utf8'));
    expect(claims.sub).toBe(user.oidcSub);
    expect(claims.sid).toBeDefined();
  });

  it('an unknown user id loads as null', async () => {
    const user = await auth.loadUser(brand('00000000-0000-7000-8000-000000000000', 'UserID'));
    expect(user).toBeNull();
  });
});
