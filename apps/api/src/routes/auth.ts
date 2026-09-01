/**
 * Auth HTTP routes (day-01 §2.3) — the OIDC Authorization Code + PKCE flow.
 *
 * - `GET  /api/auth/login`    → build `state` + PKCE `code_verifier`, redirect to the IdP.
 * - `GET  /api/auth/callback` → exchange the code, upsert the user on `oidc_sub`,
 *                               create a session, set the httpOnly `sid` cookie,
 *                               and return the access JWT for API clients.
 * - `GET  /api/auth/session`  → return the current user (or 401).
 * - `POST /api/auth/logout`   → revoke the session row + clear the cookie.
 *
 * The `state`/`code_verifier` pair is held in a short-lived in-memory map, which
 * is correct for a single-process deployment (this harness's shape) — a
 * multi-replica rollout would move it to the DB. The redirect URI is derived
 * from `APP_URL` so the demo works behind a tunnel/port change.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';

import { AuthService, SessionService } from '@harness/auth';
import type { OidcProvider } from '@harness/auth';
import { brand } from '@harness/domain';
import type { SessionID } from '@harness/domain';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';

import { randomToken, readCookie } from '../auth.js';

/** TTL for the PKCE/state nonce held between login and callback. */
const PENDING_TTL_MS = 10 * 60_000;

interface PendingLogin {
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly issuedAt: number;
}

const pendingLogins = new Map<string, PendingLogin>();

/** Sweep expired pending logins (cheap; called once per login). */
function prunePendingLogins(): void {
  const now = Date.now();
  for (const [state, entry] of pendingLogins) {
    if (now - entry.issuedAt > PENDING_TTL_MS) {
      pendingLogins.delete(state);
    }
  }
}

/** Periodic sweep so expired entries are reclaimed even during idle periods. */
let pruneTimer: ReturnType<typeof setInterval> | null = null;
export function startPendingLoginPruner(intervalMs = 5 * 60_000): void {
  if (pruneTimer !== null) return;
  prunePendingLogins();
  pruneTimer = setInterval(prunePendingLogins, intervalMs);
}
export function stopPendingLoginPruner(): void {
  if (pruneTimer !== null) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

/** The absolute callback URL the IdP redirects to. */
function callbackUrl(): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/auth/callback`;
}

/** Set the httpOnly session cookie (manually, to avoid a cookie-plugin dep). */
function setSessionCookie(reply: FastifyReply, sid: string): void {
  const secure = process.env.COOKIE_SECURE === 'true';
  reply.header(
    'set-cookie',
    `sid=${sid}; HttpOnly; SameSite=Lax; ${secure ? 'Secure; ' : ''}Path=/`,
  );
}

/** Register the four auth endpoints. */
export function registerAuthRoutes(app: FastifyInstance, container: Container): void {
  startPendingLoginPruner();

  const resolve = () => ({
    provider: container.resolve<OidcProvider>(TOKENS.OidcProvider),
    auth: container.resolve<AuthService>(TOKENS.AuthService),
  });

  app.get('/api/auth/login', async (_request, reply) => {
    prunePendingLogins();
    const { provider } = resolve();
    const state = randomToken();
    const codeVerifier = randomToken();
    const redirectUri = callbackUrl();
    pendingLogins.set(state, { codeVerifier, redirectUri, issuedAt: Date.now() });

    const url = await provider.getAuthorizationUrl(state, codeVerifier, redirectUri);
    return reply.code(302).header('location', url).send();
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/api/auth/callback',
    async (request, reply) => {
      const { code, state } = request.query;
      if (!code || !state) {
        return reply.code(400).send({ error: 'missing code or state' });
      }
      const pending = pendingLogins.get(state);
      if (!pending) {
        return reply.code(400).send({ error: 'unknown or expired state' });
      }
      pendingLogins.delete(state);

      const { provider, auth } = resolve();
      const tokenSet = await provider.exchangeCode(code, pending.codeVerifier, pending.redirectUri);
      const userInfo = await provider.getUserInfo(tokenSet.accessToken);

      const user = await auth.findOrCreateUser({
        sub: userInfo.sub,
        email: userInfo.email,
        ...(userInfo.name ? { name: userInfo.name } : {}),
      });
      const session = await auth.createSession(user.id);
      setSessionCookie(reply, session.id);
      const token = await auth.issueAccessToken(user, session.id);

      return {
        token,
        user: { id: user.id, sub: user.oidcSub, email: user.email, roles: user.roles },
      };
    },
  );

  app.get('/api/auth/session', async (request, reply) => {
    if (!request.auth) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const { user, sid } = request.auth;
    return {
      user: {
        id: user.id,
        sub: user.oidcSub,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
      },
      sid,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const sid = request.auth?.sid ?? readCookie(request.headers.cookie, 'sid');
    if (sid) {
      const sessionService = container.resolve<SessionService>(TOKENS.SessionService);
      await sessionService.revokeSession(brand(sid, 'SessionID') as SessionID);
    }
    reply.header('set-cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return { ok: true };
  });

  // Clean up the periodic pruner when the server shuts down.
  app.addHook('onClose', () => {
    stopPendingLoginPruner();
  });
}
