/**
 * Prometheus scrape endpoint (day-04 §2.3, §3.3).
 *
 * Replaces the Phase-1 hand-rolled `/api/ops/metrics` JSON with a real
 * Prometheus text scrape. The register is `@harness/observability`'s
 * process-global, so the endpoint exposes everything Day-04's recorders —
 * routing, review dwell, usefulness — and Day-06's offline gauges emit, without
 * the app re-initialising any registry lifetime.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { register } from '@harness/observability';

/**
 * Optional bearer-token guard for the Prometheus scrape endpoint.
 *
 * Prometheus scrapes không dùng được OIDC flow của app; mở đường của riêng nó
 * qua METRICS_BEARER_TOKEN. Không set (local dev, single-machine Phase 1) →
 * endpoint mở như cũ kèm warning; set → bắt buộc `Authorization: Bearer`.
 */
function constantTimeEqual(a: string, b: string): boolean {
  // HMAC để hai chuỗi khác độ dài cũng so sánh constant-time.
  const mac = (s: string) => createHmac('sha256', 'metrics-guard').update(s).digest();
  return timingSafeEqual(mac(a), mac(b));
}

function metricsAuthorized(request: FastifyRequest): boolean {
  const expected = process.env.METRICS_BEARER_TOKEN;
  if (!expected) {
    return true; // unconfigured → open (dev / loopback-only deployment)
  }
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return false;
  }
  return constantTimeEqual(header.slice(7), expected);
}

/** Serve all registered metrics in Prometheus text format. */
export function registerMetricsRoutes(app: FastifyInstance): void {
  if (!process.env.METRICS_BEARER_TOKEN) {
    // Warn một lần lúc startup — operator cần biết endpoint đang mở. Console
    // là kênh duy nhất khả dụng ở đây: hàm này chạy trước container (không có
    // Logger) và ngay cả trong dev thuần không qua bootstrap.
    // eslint-disable-next-line no-console -- startup warning before Logger exists
    console.warn('[metrics] METRICS_BEARER_TOKEN unset — /metrics is unauthenticated');
  }

  app.get('/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!metricsAuthorized(req)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    reply.header('Content-Type', register.contentType);
    reply.send(await register.metrics());
  });
}
