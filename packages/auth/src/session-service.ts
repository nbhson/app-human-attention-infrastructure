/**
 * `SessionService` (day-01 §2.2) — the *revocable* half of identity.
 *
 * The JWT is stateless and short-lived; this service owns the DB-backed
 * `sessions` row that makes revocation a database truth instead of a token-format
 * trick. `revoked_at IS NULL` is active; logging out sets it in a single guarded
 * UPDATE, which kills every token minted under the session — a still-valid
 * signature is not enough once the session is gone.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { sessions as sessionsTable } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { brand, newSessionID } from '@harness/domain';
import type { Session, SessionID, UserID } from '@harness/domain';

/** Rolling session lifetime. Configurable so the demo/test can shrink it. */
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Persistence for `SessionService` (kept small so tests use a real DrizzleDB). */
export class SessionService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly ttlMs: number = DEFAULT_SESSION_TTL_MS,
  ) {}

  /** Create a session expiring `ttlMs` from now. */
  async createSession(userId: UserID): Promise<Session> {
    const id = newSessionID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + this.ttlMs);
    await this.db.insert(sessionsTable).values({
      id,
      user_id: userId,
      issued_at: issuedAt,
      expires_at: expiresAt,
    });
    return { id, userId, issuedAt, expiresAt, revokedAt: null };
  }

  /** Revoke a session (logout / compromise). Guarded so a double-logout is a no-op. */
  async revokeSession(sid: SessionID): Promise<void> {
    await this.db
      .update(sessionsTable)
      .set({ revoked_at: new Date() })
      .where(and(eq(sessionsTable.id, sid), isNull(sessionsTable.revoked_at)));
  }

  /** Roll the session's expiry forward on activity (a rolling window). */
  async touchSession(sid: SessionID): Promise<void> {
    await this.db
      .update(sessionsTable)
      .set({ expires_at: new Date(Date.now() + this.ttlMs) })
      .where(and(eq(sessionsTable.id, sid), isNull(sessionsTable.revoked_at)));
  }

  /** Load a session row, or `null` if it does not exist or is revoked. */
  async findActiveSession(sid: SessionID): Promise<Session | null> {
    const rows = await this.db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sid), isNull(sessionsTable.revoked_at)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: brand(row.id, 'SessionID'),
      userId: brand(row.user_id, 'UserID'),
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }
}
