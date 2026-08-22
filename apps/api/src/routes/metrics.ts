/**
 * Prometheus scrape endpoint (day-04 §2.3, §3.3).
 *
 * Replaces the Phase-1 hand-rolled `/api/ops/metrics` JSON with a real
 * Prometheus text scrape. The register is `@harness/observability`'s
 * process-global, so the endpoint exposes everything Day-04's recorders —
 * routing, review dwell, usefulness — and Day-06's offline gauges emit, without
 * the app re-initialising any registry lifetime.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { register } from '@harness/observability';

/** Serve all registered metrics in Prometheus text format. */
export function registerMetricsRoutes(app: FastifyInstance): void {
  app.get('/metrics', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Content-Type', register.contentType);
    reply.send(await register.metrics());
  });
}
