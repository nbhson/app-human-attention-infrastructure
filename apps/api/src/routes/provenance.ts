/**
 * Provenance HTTP route (day-26 §2.2) — a thin, read-only Fastify surface over
 * the Day-17 `buildProvenanceChain` query.
 *
 * Returns the seven-section causal trail for any task — a COMPLETED run and a
 * FAILED one render the same shape (§5 acceptance). Read-only by design: the plan
 * forbids a "fix it from the UI" affordance here; intervention goes through the
 * review queue or a CLI runbook, never this endpoint.
 */

import type { FastifyInstance } from 'fastify';

import { buildProvenanceChain } from '@harness/artifact-tracker';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import type { DrizzleDB } from '@harness/db';
import { brand } from '@harness/domain';

/** Register `GET /api/tasks/:id/provenance`. */
export function registerProvenanceRoutes(app: FastifyInstance, container: Container): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);

  app.get<{ Params: { id: string } }>('/api/tasks/:id/provenance', async (request, reply) => {
    const chain = await buildProvenanceChain(db, brand(request.params.id, 'TaskID'));
    if (chain.task === null) {
      return reply.code(404).send({ error: 'task not found' });
    }
    return chain;
  });
}
