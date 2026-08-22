/**
 * `AuthService` (day-01 §3.2) — identity source of truth.
 *
 * The two responsibilities:
 *  1. **provision** — `findOrCreateUser` upserts on the provider-stable
 *     `oidc_sub`. Re-login refreshes display claims (`email`, `display_name`) but
 *     **never** rewrites `roles` (otherwise every login resets an admin to
 *     `OPERATOR`).
 *  2. **assert** — `validateAccessToken` is a **two-check** gate (§2.2), in order:
 *     verify the JWT signature/expiry first (a forged token must not trigger a DB
 *     round-trip), *then* confirm the session row is active (`revoked_at IS NULL`).
 *     A leaked signed token is dead the moment its session is revoked.
 */

import { eq } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';

import { users } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { brand, DEFAULT_ROLES, newUserID } from '@harness/domain';
import type { AuthContext, OidcUserInfo, Session, SessionID, User } from '@harness/domain';
import type { UserID } from '@harness/domain';

import { InvalidTokenError, SessionRevokedError } from './errors.js';
import type { SessionService } from './session-service.js';

/** Access-token lifetime (§2.2): short-lived by design; the session is the revocable truth. */
export const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Claims embedded in the access token, keyed on the stable `sub`. */
interface AccessTokenClaims extends JWTPayload {
  readonly uid: string; // internal UserID
  readonly sid: string; // SessionID
  readonly email?: string;
  readonly roles?: readonly string[];
}

/** Auth package configuration. */
export interface AuthConfig {
  /** HS256 secret for access tokens (never commit a real one). */
  readonly jwtSecret: string;
  readonly tokenTtlMs?: number;
}

/** Turns a drizzle `users` row into the domain {@link User}. */
function toUser(row: {
  id: string;
  oidc_sub: string;
  email: string;
  display_name: string;
  roles: string[];
  created_at: Date;
  updated_at: Date;
}): User {
  return {
    id: brand(row.id, 'UserID'),
    oidcSub: row.oidc_sub,
    email: row.email,
    displayName: row.display_name,
    roles: row.roles as User['roles'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The identity/assertion service. */
export class AuthService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly sessions: SessionService,
    private readonly config: AuthConfig,
  ) {}

  /**
   * Upsert a user keyed on `oidc_sub`. First sight assumes `DEFAULT_ROLES`;
   * subsequent logins refresh only display claims (see `./identity.ts`).
   */
  async findOrCreateUser(userInfo: OidcUserInfo): Promise<User> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.oidc_sub, userInfo.sub))
      .limit(1);
    const existing = rows[0];
    if (existing) {
      const updated = await this.db
        .update(users)
        .set({
          email: userInfo.email,
          display_name: userInfo.name?.trim() || existing.display_name,
          updated_at: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return toUser(updated[0]!);
    }

    const id = newUserID();
    const now = new Date();
    const inserted = await this.db
      .insert(users)
      .values({
        id,
        oidc_sub: userInfo.sub,
        email: userInfo.email,
        display_name: userInfo.name?.trim() || 'Reviewer',
        roles: [...DEFAULT_ROLES],
        created_at: now,
        updated_at: now,
      })
      .returning();
    return toUser(inserted[0]!);
  }

  /** Mint a short-lived JWT whose revocation anchor is `sid`. */
  async issueAccessToken(user: User, sid: SessionID): Promise<string> {
    const ttlMs = this.config.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    const now = Date.now();
    const secret = new TextEncoder().encode(this.config.jwtSecret);
    return new SignJWT({
      uid: user.id,
      sid,
      email: user.email,
      roles: user.roles,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.oidcSub) // provider-stable subject; NOT email
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor((now + ttlMs) / 1000))
      .sign(secret);
  }

  /** Guarded two-check validation: signature first, then the revocable session. */
  async validateAccessToken(token: string): Promise<AuthContext> {
    let payload: AccessTokenClaims;
    try {
      const secret = new TextEncoder().encode(this.config.jwtSecret);
      const { payload: p } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
      payload = p as AccessTokenClaims;
    } catch {
      throw new InvalidTokenError();
    }

    if (!payload.sid || !payload.uid) {
      throw new InvalidTokenError('token is missing identity claims');
    }

    const session = await this.sessions.findActiveSession(brand(payload.sid, 'SessionID'));
    if (!session) {
      throw new SessionRevokedError();
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new SessionRevokedError();
    }

    const user = await this.loadUser(brand(session.userId, 'UserID'));
    if (!user) {
      throw new InvalidTokenError('token references an unknown user');
    }

    return { user, sid: session.id, roles: user.roles };
  }

  /** Load a user by internal id, or `null`. */
  async loadUser(id: UserID): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  /**
   * Resolve a principal from a session id (the cookie path — no JWT in the
   * request). Returns `null` when the session is unknown, expired, or revoked.
   */
  async resolveSessionContext(sid: SessionID): Promise<AuthContext | null> {
    const session = await this.sessions.findActiveSession(sid);
    if (!session || session.expiresAt.getTime() < Date.now()) {
      return null;
    }
    const user = await this.loadUser(session.userId);
    if (!user) {
      return null;
    }
    return { user, sid: session.id, roles: user.roles };
  }

  /** Session-service passthrough so routes only need `AuthService`. */
  async createSession(userId: UserID): Promise<Session> {
    return this.sessions.createSession(userId);
  }

  async revokeSession(sid: SessionID): Promise<void> {
    await this.sessions.revokeSession(sid);
  }
}
