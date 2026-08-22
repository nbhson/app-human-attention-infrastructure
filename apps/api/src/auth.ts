/**
 * Request-scoped auth context (day-01 §3.4).
 *
 * A single `onRequest` hook populates `request.auth` from *either* an
 * `Authorization: Bearer <jwt>` header (API clients) *or* the httpOnly `sid`
 * cookie (the browser). A missing/invalid credential leaves `request.auth`
 * undefined, and the route decides what that means (Day 02's `requireRole`
 * treats it as 401). Authorization is deliberately NOT this hook's job — it
 * only establishes identity (day-02 §6: auth ≠ authz).
 */

import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AuthService } from '@harness/auth';
import type { AuthContext } from '@harness/domain';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated principal, or undefined when no valid credential was presented. */
    auth: AuthContext | undefined;
  }
}

/** Read the `name` cookie from a raw Cookie header (kept dependency-free). */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    if (key === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/** Generate a URL-safe random token for OIDC `state` / PKCE `code_verifier`. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Register the identity-establishing onRequest hook over the container. */
export function registerAuthHook(app: FastifyInstance, container: Container): void {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const authService = container.resolve<AuthService>(TOKENS.AuthService);

    const bearer = request.headers.authorization;
    if (bearer && bearer.startsWith('Bearer ')) {
      try {
        request.auth = await authService.validateAccessToken(bearer.slice(7));
      } catch {
        request.auth = undefined; // an invalid token is treated as absent for this hook
      }
      return;
    }

    const sid = readCookie(request.headers.cookie, 'sid');
    if (sid) {
      request.auth =
        (await authService.resolveSessionContext(sid as AuthContext['sid'])) ?? undefined;
    }
  });
}
