/**
 * `@harness/observability` — the OpenTelemetry substrate (day-03).
 *
 * Owns the tracer and meter providers plus the async-local correlation context
 * that links spans to the in-flight `correlation_id`. Engines instrument by
 * importing {@link withSpan} / {@link runWithCorrelation}; they never touch the
 * OTel API directly. The package may import only shared infra
 * (`@harness/domain`, `@harness/db`, `@harness/di`) — boundary R8.
 */

export { runWithCorrelation, currentCorrelation, type CorrelationCtx } from './context.js';
export {
  initTracing,
  getTracer,
  startSpan,
  endSpan,
  withSpan,
  activeSpanContext,
  activateSpan,
  inMemoryExporter,
  resetTracing,
  type TracingOptions,
  type WithSpanOptions,
  type TraceCorrelationRow,
  type TraceCorrelationWriter,
} from './tracer.js';
export type { Span, SpanContext, Attributes } from '@opentelemetry/api';
export { getMeter, setMeterName } from './meter.js';
export {
  register,
  gauges,
  routed,
  usefulness,
  reviewDwell,
  resupply,
  cacheHit,
  cacheMiss,
  sandboxRun,
  sandboxFallback,
  sandboxDuration,
  objectIntegrityError,
  setGauge,
  recordRouted,
  observeReviewDwell,
  recordUsefulness,
  recordCacheHit,
  recordCacheMiss,
  recordSandboxRun,
  recordSandboxFallback,
  observeSandboxDuration,
  recordObjectIntegrityError,
  snapshotInfraCounters,
  resetInfraCounters,
  type InfraCountersSnapshot,
} from './metrics.js';
