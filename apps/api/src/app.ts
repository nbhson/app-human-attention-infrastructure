/**
 * The Fastify app factory (`apps/api`).
 *
 * `buildContainer` wires the object graph; `buildApp` builds the HTTP surface on
 * top of it. Both the server (`index.ts`) and the Day-25 E2E driver build the same
 * graph but drive it differently — the server listens, the driver asserts — so an
 * E2E run exercises exactly the code paths a real request does.
 */

import Fastify from 'fastify';

import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import type { DrizzleDB } from '@harness/db';

import { registerReviewRoutes } from './routes/review.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerProvenanceRoutes } from './routes/provenance.js';
import { registerOpsRoutes } from './routes/ops.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAuthHook } from './auth.js';
import { registerTraceHook } from './trace.js';

/** Build the Fastify app over an already-wired container. */
export function buildApp(container: Container, opts?: { readonly logger?: boolean }) {
  const app = Fastify({ logger: opts?.logger ?? false });

  app.get('/health', async () => ({ status: 'ok' }));

  // Tracing first: the `http.request` span must wrap identity + handler work
  // so every span created inside the request becomes its child (day-03 §3.3).
  registerTraceHook(app);

  // Identity next: every handler may read `request.auth` (day-01 §3.4).
  registerAuthHook(app, container);

  registerAuthRoutes(app, container);
  registerReviewRoutes(app, container);
  registerTaskRoutes(app, container);
  registerProvenanceRoutes(app, container);
  registerOpsRoutes(app, container.resolve<DrizzleDB>(TOKENS.Db));

  return app;
}
