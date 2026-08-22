/**
 * Async-local correlation context (day-03 §2.1).
 *
 * Spans do not know about a harness task unless we tell them. An
 * `AsyncLocalStorage` carries `{ correlationId, taskId }` through the request
 * lifecycle so that {@link withSpan} can stamp `harness.correlation_id` at the
 * *point a span starts* — without threading an extra id through every method
 * signature.
 *
 * The boundary note in the day-03 spec is the key invariant: the store leaks
 * across `await` freely (that is exactly what we rely on), but every async
 * worker — an event-handler callback, a poll-loop tick — must re-establish
 * context via {@link runWithCorrelation} before it starts spans. There is no
 * ambient context off a request.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The correlation identity flowing through one causal unit of work.
 *
 * `correlationId` is the OTel span attribute value; in Phase 1-2 it is the task
 * lifecycle id — the same value `event_log.correlation_id` records (day-27
 * §2.2), so traces and the event log reconcile by construction.
 */
export interface CorrelationCtx {
  readonly correlationId: string;
  /** The harness task id when this correlation is a task lifecycle (else unset). */
  readonly taskId?: string;
}

const store = new AsyncLocalStorage<CorrelationCtx | undefined>();

/** Run `fn` with a correlation identity bound to the current async region. */
export function runWithCorrelation<T>(ctx: CorrelationCtx, fn: () => T): T {
  return store.run(ctx, fn);
}

/**
 * The correlation identity in effect right now. Returns a stable `'bootstrap'`
 * marker outside any established context — the same "off a task" default the
 * phase-1 tracing substrate uses — so a stray span is labelled rather than
 * silently correlated.
 */
export function currentCorrelation(): CorrelationCtx {
  return store.getStore() ?? { correlationId: 'bootstrap' };
}
