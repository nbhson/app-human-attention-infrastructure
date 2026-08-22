/**
 * Prometheus `/metrics` endpoint test (day-04 §3.5).
 *
 * The route needs no DB — it serves the process-global prom-client register — so
 * the test reproduces `buildApp`'s route registration over a bare Fastify app,
 * emits a couple of records, and asserts the scrape returns Prometheus text with
 * the HELP/TYPE lines the acceptance criteria require.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { observeReviewDwell, recordRouted, reviewDwell, routed } from '@harness/observability';

import { registerMetricsRoutes } from '../routes/metrics.js';

function buildApp() {
  const app = Fastify({ logger: false });
  registerMetricsRoutes(app);
  return app;
}

beforeEach(() => {
  // Reset in place — see observability metrics.test.ts for why not clear().
  routed.reset();
  reviewDwell.reset();
});

describe('GET /metrics', () => {
  it('returns Prometheus text with HELP/TYPE for the emitted metrics', async () => {
    recordRouted('human');
    observeReviewDwell(90);
    const app = buildApp();

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const body = res.body;
    expect(body).toContain('# HELP harness_routing_items_total');
    expect(body).toContain('# TYPE harness_routing_items_total counter');
    expect(body).toContain('harness_routing_items_total{route="human"} 1');
    expect(body).toContain('# TYPE harness_review_dwell_seconds histogram');
    await app.close();
  });
});
