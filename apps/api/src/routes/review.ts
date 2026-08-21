/**
 * Review HTTP routes (day-22 §3) — the thin Fastify surface over
 * {@link ReviewService}.
 *
 * The service owns the domain logic and the guarded writes; these routes only
 * coerce raw params/body into branded ids and map the review-specific errors
 * onto 4xx status codes (day-22 §3.3): not-found → 404, claim/decide/drop on the
 * wrong state → 409, missing rationale → 400. Anything else is left to Fastify's
 * default 500 handler.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';

import { brand } from '@harness/domain';
import {
  MissingRationaleError,
  QueueConflictError,
  QueueItemNotFoundError,
  QueueStateError,
  ReviewError,
  ReviewService,
} from '@harness/review';

/** Raw shapes the routes accept; the service re-brands what it needs. */
interface ClaimBody {
  readonly reviewerId: string;
}
interface DecideBody {
  readonly decision: 'APPROVE' | 'REJECT';
  readonly rationale: string;
  readonly wasUseful: boolean;
  readonly comment?: string;
  readonly reviewerId: string;
}
interface DropBody {
  readonly rationale: string;
  readonly reviewerId: string;
}

/** Map a review failure onto the right HTTP status (day-22 §3.3). */
function toErrorReply(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof QueueItemNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  if (error instanceof QueueConflictError || error instanceof QueueStateError) {
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

/** Register the five review endpoints under `/api/review`. */
export function registerReviewRoutes(app: FastifyInstance, reviewService: ReviewService): void {
  app.get('/api/review/queue', async () => reviewService.listQueue());

  app.get<{ Params: { id: string } }>('/api/review/queue/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      return await reviewService.getDetail(brand(id, 'ReviewQueueItemID'));
    } catch (error) {
      return toErrorReply(reply, error);
    }
  });

  app.post<{ Params: { id: string }; Body: ClaimBody }>(
    '/api/review/queue/:id/claim',
    async (request, reply) => {
      try {
        const { id } = request.params;
        return await reviewService.claim(
          brand(id, 'ReviewQueueItemID'),
          brand(request.body.reviewerId, 'ReviewerID'),
        );
      } catch (error) {
        return toErrorReply(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: DecideBody }>(
    '/api/review/queue/:id/decide',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const body = request.body;
        return await reviewService.decide(brand(id, 'ReviewQueueItemID'), {
          decision: body.decision,
          rationale: body.rationale,
          wasUseful: body.wasUseful,
          ...(body.comment === undefined ? {} : { comment: body.comment }),
          reviewerId: brand(body.reviewerId, 'ReviewerID'),
        });
      } catch (error) {
        return toErrorReply(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: DropBody }>(
    '/api/review/queue/:id/drop',
    async (request, reply) => {
      try {
        const { id } = request.params;
        await reviewService.drop(brand(id, 'ReviewQueueItemID'), {
          rationale: request.body.rationale,
          reviewerId: brand(request.body.reviewerId, 'ReviewerID'),
        });
        return { ok: true };
      } catch (error) {
        return toErrorReply(reply, error);
      }
    },
  );
}
