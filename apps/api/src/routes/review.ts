/**
 * Review HTTP routes (day-22 §3, day-02 §3.3) — the thin Fastify surface over
 * {@link ReviewService}, now guarded.
 *
 * The service owns the domain logic and the guarded writes; these routes coerce
 * raw params/bodies into branded ids and map review-specific errors onto 4xx
 * status codes (day-22 §3.3): not-found → 404, wrong-state → 409, missing
 * rationale → 400.
 *
 * Day 02 adds authorization: every mutating (and the queue/detail) route is
 * wrapped in {@link requireRole}, and the reviewer/actor identity comes from the
 * authenticated principal (`request.auth.user`), never from a header or body —
 * the Phase-1 reviewer-id header / body `reviewerId` path is gone.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';

import { brand, Role } from '@harness/domain';
import { requireRole } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import {
  EvidenceNotFoundError,
  IllegalTransitionError,
  MissingRationaleError,
  QueueConflictError,
  QueueItemNotFoundError,
  QueueStateError,
  ReviewError,
  ReviewService,
} from '@harness/review';

import type { QueueDecideBody, RationaleBody } from './shared-types.js';

/** Safely extract the authenticated user; returns 401 when missing. */
function assertUser(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
): NonNullable<typeof request.auth>['user'] | null {
  const user = request.auth?.user;
  if (!user) {
    void reply.code(401).send({ error: 'unauthenticated' });
    return null;
  }
  return user;
}

/** Map a review failure onto the right HTTP status (day-22 §3.3). */
function toErrorReply(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof QueueItemNotFoundError || error instanceof EvidenceNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  if (
    error instanceof QueueConflictError ||
    error instanceof QueueStateError ||
    error instanceof IllegalTransitionError
  ) {
    return reply.code(409).send({ error: error.message });
  }
  if (error instanceof MissingRationaleError) {
    return reply.code(400).send({ error: error.message });
  }
  if (error instanceof ReviewError) {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
}

/** Register the review endpoints under `/api/review`. */
export function registerReviewRoutes(app: FastifyInstance, container: Container): void {
  const reviewService = container.resolve<ReviewService>(TOKENS.ReviewService);
  const canReview = requireRole(container, Role.Reviewer, Role.Admin);

  app.get<{ Querystring: { status?: string } }>(
    '/api/review/queue',
    { preHandler: requireRole(container, Role.Reviewer, Role.Admin) },
    async (request) => reviewService.listQueue(request.query.status),
  );

  app.get<{ Params: { id: string } }>('/api/review/evidence/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      return await reviewService.getEvidence(brand(id, 'EvidenceID'));
    } catch (error) {
      return toErrorReply(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/review/queue/:id',
    { preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) },
    async (request, reply) => {
      try {
        const { id } = request.params;
        return await reviewService.getDetail(brand(id, 'ReviewQueueItemID'));
      } catch (error) {
        return toErrorReply(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/review/queue/:id/claim',
    { preHandler: canReview },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = assertUser(request, reply);
        if (!user) return reply;
        return await reviewService.claim(
          brand(id, 'ReviewQueueItemID'),
          brand(user.id, 'ReviewerID'),
        );
      } catch (error) {
        return toErrorReply(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: QueueDecideBody }>(
    '/api/review/queue/:id/decide',
    { preHandler: canReview },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const body = request.body;
        const user = assertUser(request, reply);
        if (!user) return reply;
        return await reviewService.decide(brand(id, 'ReviewQueueItemID'), {
          decision: body.decision,
          rationale: body.rationale,
          wasUseful: body.wasUseful,
          ...(body.comment === undefined ? {} : { comment: body.comment }),
          reviewerId: brand(user.id, 'ReviewerID'),
          actorId: user.id,
          actorEmail: user.email,
        });
      } catch (error) {
        return toErrorReply(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: RationaleBody }>(
    '/api/review/queue/:id/drop',
    { preHandler: canReview },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = assertUser(request, reply);
        if (!user) return reply;
        await reviewService.drop(brand(id, 'ReviewQueueItemID'), {
          rationale: request.body.rationale,
          reviewerId: brand(user.id, 'ReviewerID'),
          actorId: user.id,
          actorEmail: user.email,
        });
        return { ok: true };
      } catch (error) {
        return toErrorReply(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/review/queue/:id/release',
    { preHandler: canReview },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = assertUser(request, reply);
        if (!user) return reply;
        await reviewService.release(brand(id, 'ReviewQueueItemID'), {
          actorId: user.id,
          actorEmail: user.email,
        });
        return { ok: true };
      } catch (error) {
        return toErrorReply(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: RationaleBody }>(
    '/api/review/queue/:id/escalate',
    { preHandler: canReview },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = assertUser(request, reply);
        if (!user) return reply;
        return await reviewService.escalate(brand(id, 'ReviewQueueItemID'), {
          rationale: request.body.rationale,
          reviewerId: brand(user.id, 'ReviewerID'),
          actorId: user.id,
          actorEmail: user.email,
        });
      } catch (error) {
        return toErrorReply(reply, error);
      }
    },
  );
}
