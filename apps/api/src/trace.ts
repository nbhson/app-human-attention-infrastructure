/**
 * Per-request `http.request` span (day-03 §3.3).
 *
 * On every request we mint a fresh correlation id, bind it into the
 * AsyncLocalStorage *correlation* context, and start a root `http.request`
 * span that carries it as `harness.correlation_id`. The span is left active
 * for the whole request, so any span created deep in a handler (e.g.
 * `review.decide`, `agent.run`) becomes a child of it — a single HTTP trace
 * can therefore carry *several* correlation ids: the request's own, plus the
 * task ids of whatever decision/verification it touched (§2.4 caveat). The
 * root span's write-through records the request's correlation in
 * `trace_correlation`; the engine spans record each task's. Neither shadows
 * the other — a trace is a join across both.
 *
 * Like the auth hook, this is `done`-style: calling `done()` *inside*
 * `runWithCorrelation(...)` keeps the correlation context alive across the
 * remainder of the request (downstream hooks + handler), and lets
 * `startSpan` read the just-set `currentCorrelation()` as its root correlation.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { newCorrelationID } from '@harness/domain';
import { activateSpan, endSpan, runWithCorrelation, startSpan } from '@harness/observability';
import type { Span } from '@harness/observability';

declare module 'fastify' {
  interface FastifyRequest {
    /** The `http.request` span for this request, opened in onRequest. */
    traceSpan?: Span;
  }
}

/** Register the tracing onRequest/onResponse hook pair over the app. */
export function registerTraceHook(app: FastifyInstance): void {
  app.addHook('onRequest', (request: FastifyRequest, _reply, done) => {
    runWithCorrelation({ correlationId: newCorrelationID() }, () => {
      const span = startSpan('http.request', {
        'http.method': request.method,
        'http.route': request.routeOptions?.url ?? request.url,
      });
      request.traceSpan = span;
      // Like the auth hook, activate the span and call `done()` *inside* it so
      // the rest of the request (downstream hooks + handler) runs with this span
      // as the active parent — every span opened in the handler becomes its child.
      activateSpan(span, () => done());
    });
  });

  app.addHook('onResponse', (request: FastifyRequest, _reply, done) => {
    const span = request.traceSpan;
    if (span) {
      endSpan(span);
    }
    done();
  });
}
