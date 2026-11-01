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

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AuthService, SessionService } from '@harness/auth';
import type { OidcProvider } from '@harness/auth';
import { brand } from '@harness/domain';
import type { SessionID } from '@harness/domain';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';

import { randomToken, readCookie } from '../auth.js';
import { checkSensitiveRateLimit } from '../rate-limit.js';

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

/**
 * Host allowlist for mock-mode callback derivation (open-redirect guard).
 *
 * The mock-mode derivation below trusts request-supplied headers
 * (Origin/Referer/X-Forwarded-Host), which a crafted request could point at an
 * attacker-controlled host. Only hosts on `OIDC_MOCK_ALLOWED_HOSTS`
 * (comma-separated; default `localhost,127.0.0.1`) are honoured — any other
 * host falls through to the static `APP_URL` default. Mock mode only: with a
 * real IdP the redirect URI must match the pre-registered one, so headers are
 * never consulted there.
 */
function mockAllowedHosts(): readonly string[] {
  const raw = process.env.OIDC_MOCK_ALLOWED_HOSTS ?? 'localhost,127.0.0.1';
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** True when `host` (an optional `:port` authority) is on the mock allowlist. */
function isAllowedMockHost(host: string): boolean {
  const allowed = mockAllowedHosts();
  const lowered = host.toLowerCase();
  if (allowed.includes(lowered)) return true;
  // A `host:port` authority is allowed when its hostname part is allowlisted.
  const hostname = lowered.split(':')[0] ?? '';
  return hostname.length > 0 && allowed.includes(hostname);
}

/** The absolute callback URL the IdP redirects to. */
function callbackUrl(request?: FastifyRequest): string {
  // LAN fix: the old code always returned `${APP_URL}/api/auth/callback`
  // (default http://localhost:3000). A browser on another machine in the LAN
  // that opens http://<server-ip>:5174/api/auth/login gets a 302 to
  // `http://localhost:3000/...` — `localhost` there resolves to *its own*
  // machine, so login never completes and every later `/api/reviews` call
  // stays 401 (no `sid` cookie for the LAN host).
  //
  // When the mock IdP is in use there is no pre-registered redirect URI to
  // honour (the mock just echoes back to whatever `redirectUri` we pass), so
  // we can derive the base from the incoming request: prefer the
  // browser-facing origin (Origin/Referer carry the LAN host
  // `http://192.168.x.x:5174` even when Vite proxies with `Host:
  // localhost:3000`), then X-Forwarded-Host/Host, and only fall back to
  // APP_URL. Callbacks then flow back through the same host:port the browser
  // used (e.g. via the Vite `/api` proxy), the `sid` cookie is set for the
  // LAN host, and `credentials: 'include'` fetches from `:5174` are
  // authenticated — no need to expose `:3000` to the LAN.
  //
  // Because those headers are request-supplied, the derived host must be on
  // the mock allowlist (see {@link mockAllowedHosts}); anything else — and any
  // request when the mock is off — falls back to the static APP_URL, so a
  // crafted Origin cannot turn the login redirect into an open redirect.
  // The default allowlist is localhost/127.x only; a LAN deployment opts the
  // server's IP back in via `OIDC_MOCK_ALLOWED_HOSTS` (e.g. `192.168.1.10`).
  if (process.env.OIDC_MOCK === 'true' && request) {
    const origin = request.headers.origin ?? request.headers.referer;
    if (typeof origin === 'string') {
      const match = origin.match(/^https?:\/\/([^/]+)/);
      if (match && isAllowedMockHost(match[1] ?? '')) {
        return `${match[0].replace(/\/$/, '')}/api/auth/callback`;
      }
    }
    const forwardedHost = request.headers['x-forwarded-host'] ?? request.headers['x-forwarded-server'];
    const rawHost = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host;
    if (typeof rawHost === 'string') {
      const cleanHost = rawHost.split(',')[0]?.trim();
      if (cleanHost !== undefined && cleanHost.length > 0 && isAllowedMockHost(cleanHost)) {
        const forwardedProto = request.headers['x-forwarded-proto'];
        // Scheme: honour an explicit X-Forwarded-Proto; otherwise localhost /
        // 127.x are plain http and any other (allowlisted) host is https.
        const proto =
          (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(',')[0]?.trim() ||
          (cleanHost.startsWith('localhost') || cleanHost.startsWith('127.') ? 'http' : 'https');
        return `${proto}://${cleanHost.replace(/\/$/, '')}/api/auth/callback`;
      }
    }
  }
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/auth/callback`;
}

/** Set the httpOnly session cookie (manually, to avoid a cookie-plugin dep). */
function setSessionCookie(reply: FastifyReply, sid: string): void {
  const secure = process.env.COOKIE_SECURE === 'true';
  reply.header('set-cookie', `sid=${sid}; HttpOnly; SameSite=Lax; ${secure ? 'Secure; ' : ''}Path=/`);
}

/** Register the four auth endpoints. */
export function registerAuthRoutes(app: FastifyInstance, container: Container): void {
  startPendingLoginPruner();

  const resolve = () => ({
    provider: container.resolve<OidcProvider>(TOKENS.OidcProvider),
    auth: container.resolve<AuthService>(TOKENS.AuthService),
  });

  app.get('/api/auth/login', async (request, reply) => {
    // Abuse-sensitive like decide/retry: an unauthenticated flood here hammers
    // the IdP and grows the pendingLogins map (pruned, but why let it grow).
    if (!checkSensitiveRateLimit(request.ip)) {
      return reply.code(429).send({ error: 'rate limited — too many login attempts' });
    }
    prunePendingLogins();
    const { provider } = resolve();
    const state = randomToken();
    const codeVerifier = randomToken();
    const redirectUri = callbackUrl(request);
    pendingLogins.set(state, { codeVerifier, redirectUri, issuedAt: Date.now() });

    const url = await provider.getAuthorizationUrl(state, codeVerifier, redirectUri);
    return reply.code(302).header('location', url).send();
  });

  app.get<{ Querystring: { code?: string; state?: string } }>('/api/auth/callback', async (request, reply) => {
    if (!checkSensitiveRateLimit(request.ip)) {
      return reply.code(429).send({ error: 'rate limited — too many login attempts' });
    }
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
  });

  app.get('/api/auth/session', async (request, reply) => {
    if (!request.auth) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const { user } = request.auth;
    // P0 security fix: the raw session id is no longer echoed in the response
    // body. It already lives in the httpOnly cookie — returning it in JSON
    // made it readable to any script in the page's origin, defeating the point
    // of the httpOnly flag. Session identity travels ONLY via the cookie.
    return {
      user: {
        id: user.id,
        sub: user.oidcSub,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
      },
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
