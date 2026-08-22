/**
 * `requireRole` — the single authorization guard (day-02 §2.2).
 *
 * Role checks live here, in `@harness/auth`, and are composed into `apps/api`
 * as Fastify `preHandler`s — one call site per route, never scattered through
 * the review package. It assumes the Day-01 `onRequest` hook has already run
 * and populated `request.auth`:
 *
 * - no authenticated principal  → `401` (authentication is not authorization)
 * - authenticated but missing every required role → publishes an
 *   `authz.decision_denied` event (a denied attempt is itself evidence) and
 *   answers `403`.
 *
 * The request/reply are typed structurally so `@harness/auth` stays free of a
 * Fastify dependency; a real `FastifyRequest`/`FastifyReply` satisfies them.
 */

import { EventType, newCorrelationID, type Role, type UserID } from '@harness/domain';
import { TOKENS, type Container } from '@harness/di';
import { createEvent, type IEventBus } from '@harness/event-bus';
import type { AuthContext } from '@harness/domain';

/** The request surface the guard needs: identity + a resource to name the denial. */
export interface AuthzRequest {
  readonly auth: AuthContext | undefined;
  readonly url: string;
}

/** The reply surface the guard needs to answer 401/403. */
export interface AuthzReply {
  code(status: number): { send(body: unknown): unknown };
}

/**
 * Build a Fastify `preHandler` that admits only principals holding at least one
 * of `roles`. Pass `container` so the guard can publish the denial event.
 */
export function requireRole(
  container: Container,
  ...roles: readonly Role[]
): (request: AuthzRequest, reply: AuthzReply) => Promise<void> {
  if (roles.length === 0) {
    throw new Error('requireRole requires at least one role');
  }
  return async (request, reply) => {
    const ctx = request.auth;
    if (!ctx) {
      reply.code(401).send({ error: 'authentication required' });
      return;
    }
    if (!roles.some((role) => ctx.user.roles.includes(role))) {
      emitDenied(container, ctx.user.id, request.url, roles);
      reply.code(403).send({ error: 'insufficient role for this action' });
      return;
    }
  };
}

/** Publish `authz.decision_denied` so the refusal is queryable, not silent. */
function emitDenied(
  container: Container,
  actorId: UserID,
  resource: string,
  rolesRequired: readonly Role[],
): void {
  const bus = container.resolve<IEventBus>(TOKENS.EventBus);
  bus.publish(
    createEvent(
      EventType.AuthzDecisionDenied,
      newCorrelationID(), // no task correlation — this is a standalone audit event
      {
        actor_id: actorId,
        resource,
        roles_required: [...rolesRequired],
      },
    ),
  );
}
