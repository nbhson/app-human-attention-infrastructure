/**
 * The Fastify app factory (`apps/api`).
 *
 * `buildContainer` wires the object graph; `buildApp` builds the HTTP surface on
 * top of it. Both the server (`index.ts`) and the Day-25 E2E driver build the same
 * graph but drive it differently — the server listens, the driver asserts — so an
 * E2E run exercises exactly the code paths a real request does.
 */

import Fastify, { type FastifyInstance } from 'fastify';

import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import type { DrizzleDB } from '@harness/db';

import { registerReviewRoutes } from './routes/review.js';
import { registerReviewIngestRoutes } from './routes/reviews.js';
import { registerProvenanceRoutes } from './routes/provenance.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerOpsRoutes } from './routes/ops.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerTriageRulesRoutes } from './routes/triage-rules.js';
import { registerLearningRoutes } from './routes/learning.js';
import { registerAuthHook } from './auth.js';
import { registerTraceHook } from './trace.js';

/** Per-IP rate limit for the AI-backed review ingest endpoint (10 requests/min). */
const REVIEW_RATE_LIMIT_PER_MIN = 10;
/** TTL for a single rate-limit bucket before it resets. */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Track per-IP request counts for review ingestion. */
const reviewRateWindow = new Map<string, { count: number; resetAt: number }>();
/** Periodic sweep to evict expired buckets and prevent unbounded memory growth. */
let rateLimitPruneTimer: ReturnType<typeof setInterval> | null = null;
function startRateLimitPruner(): void {
  if (rateLimitPruneTimer !== null) return;
  rateLimitPruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of reviewRateWindow) {
      if (now > entry.resetAt) {
        reviewRateWindow.delete(ip);
      }
    }
  }, RATE_LIMIT_WINDOW_MS);
}
export function stopRateLimitPruner(): void {
  if (rateLimitPruneTimer !== null) {
    clearInterval(rateLimitPruneTimer);
    rateLimitPruneTimer = null;
  }
}

/** Simple in-process rate limiter — sufficient for single-process deployments. */
function checkReviewRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = reviewRateWindow.get(ip);
  if (entry === undefined || now > entry.resetAt) {
    reviewRateWindow.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  if (entry.count > REVIEW_RATE_LIMIT_PER_MIN) {
    return false;
  }
  return true;
}

/** Build the Fastify app over an already-wired container. */
export function buildApp(
  container: Container,
  opts?: { readonly logger?: boolean },
): FastifyInstance {
  const app = Fastify({ logger: opts?.logger ?? false });

  // CORS: the API serves a separate frontend; allow credentials so the session
  // cookie is sent across origins during dev. In production operators should
  // pin `APP_CORS_ORIGINS` to their deploy domain. Default to localhost only
  // (never `*`) to avoid leaking credentials to arbitrary origins.
  const corsOrigins = (process.env.APP_CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim());
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('access-control-allow-headers', 'content-type, authorization, x-requested-with');
    }
    if (request.method === 'OPTIONS') {
      reply.header('access-control-max-age', '86400');
      return reply.send();
    }
  });

  // Global error handler: catch anything a route forgets to handle and return a
  // structured JSON error instead of Fastify's default HTML page.
  app.setErrorHandler((error, _request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : String(error);
    reply.code(status).send({
      error: status === 500 ? 'internal_server_error' : message,
      ...(process.env.NODE_ENV !== 'production' && error instanceof Error && error.stack
        ? { stack: error.stack.split('\n').slice(0, 3).join(' | ') }
        : {}),
    });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // Tracing first: the `http.request` span must wrap identity + handler work
  // so every span created inside the request becomes its child (day-03 §3.3).
  registerTraceHook(app);

  // Identity next: every handler may read `request.auth` (day-01 §3.4).
  registerAuthHook(app, container);

  registerAuthRoutes(app, container);
  registerReviewRoutes(app, container);
  registerReviewIngestRoutes(app, container, checkReviewRateLimit);
  registerProvenanceRoutes(app, container);
  registerAuditRoutes(app, container);
  registerOpsRoutes(app, container.resolve<DrizzleDB>(TOKENS.Db));
  registerMetricsRoutes(app);
  registerAdminRoutes(app, container);
  registerSettingsRoutes(app, container);
  registerTriageRulesRoutes(app, container);
  registerLearningRoutes(app, container.resolve<DrizzleDB>(TOKENS.Db));

  // Clean up the rate-limit pruner when the server shuts down.
  app.addHook('onClose', () => {
    stopRateLimitPruner();
  });
  startRateLimitPruner();

  return app;
}
