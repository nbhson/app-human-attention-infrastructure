/**
 * OpenTelemetry tracer bootstrap (day-03 §2.5 / §3.2).
 *
 * A single module owns the `TracerProvider`. The default sink is an in-memory
 * span processor — devs and tests get spans without standing up a collector —
 * and an OTLP/HTTP batch processor is layered on only when
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Spans are started and ended via
 * {@link startSpan}/{@link endSpan} or the {@link withSpan} helper; engines
 * never touch the OTel API directly (day-03 acceptance: the only real trace
 * writes live here).
 *
 * Export failures are logged and dropped, never rethrown: a failed exporter
 * must not change the pipeline's control flow (§6 pitfalls).
 */

import { context, trace } from '@opentelemetry/api';
import type { Attributes, Span, SpanContext } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import { currentCorrelation, runWithCorrelation } from './context.js';
import type { CorrelationCtx } from './context.js';

/** The TracerProvider; built once by {@link initTracing}. */
let provider: NodeTracerProvider | undefined;

/** In-memory exporter kept alive so tests can read every recorded span. */
let inMemory: InMemorySpanExporter | undefined;

let tracerName = 'harness';

/** Row written to `trace_correlation` for root spans only (day-03 §2.3). */
export interface TraceCorrelationRow {
  readonly trace_id: string;
  readonly span_id: string;
  readonly correlation_id: string;
}

/** Fire-and-forget writer injected by the composition root (apps/api). */
export type TraceCorrelationWriter = (row: TraceCorrelationRow) => void;

let writeThrough: TraceCorrelationWriter | undefined;

/** Root-ness + correlation captured at span start, read back when it ends. */
const spanMeta = new WeakMap<Span, { readonly isRoot: boolean; readonly correlationId: string }>();

/** Options for the one-time tracing bootstrap. */
export interface TracingOptions {
  /**
   * OTLP/HTTP endpoint, e.g. `http://collector:4318/v1/traces`. When omitted,
   * the in-memory sink (plus optionally stdout JSON) remains.
   */
  readonly otlpEndpoint?: string;
  /** Also emit spans as JSON to stdout (a dev convenience). */
  readonly console?: boolean;
  /** Tracer name stamping every span (defaults to `'harness'`). */
  readonly tracerName?: string;
  /**
   * Called once per *root* span, after it ends, with its trace↔correlation
   * mapping. The composition root supplies the `trace_correlation` insert
   * (§2.3). Child spans never write through — that would turn a low-volume
   * audit table into a hot path.
   */
  readonly writeThrough?: TraceCorrelationWriter;
}

/**
 * Build the global provider and register processors. Idempotent — calling it
 * twice from two entrypoints (server boot, a test) is a no-op the second time.
 */
export function initTracing(opts: TracingOptions = {}): NodeTracerProvider {
  if (provider) {
    return provider;
  }
  if (opts.tracerName) {
    tracerName = opts.tracerName;
  }
  if (opts.writeThrough) {
    writeThrough = opts.writeThrough;
  }

  inMemory = new InMemorySpanExporter();
  provider = new NodeTracerProvider();

  // The always-on in-memory sink (tests read spans from it; devs get local
  // spans for free). SimpleSpanProcessor keeps each span available without
  // batching delays — low volume today.
  provider.addSpanProcessor(new SimpleSpanProcessor(inMemory));

  if (opts.console) {
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  const otlpEndpoint = opts.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? undefined;
  if (otlpEndpoint) {
    // Batch to amortise; export errors are swallowed by the SDK, which logs and
    // continues — the pipeline is never interrupted by a missing collector.
    provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpEndpoint })));
  }

  provider.register();
  return provider;
}

/** The OTel `Tracer` used to name every harness span (no-op until initTracing). */
export function getTracer(): ReturnType<typeof trace.getTracer> {
  return trace.getTracer(tracerName);
}

/**
 * Start a child-of-active span, stamping `harness.correlation_id` from the
 * in-flight {@link currentCorrelation}. The span is *not* ended here — callers
 * that outlive a synchronous call must {@link endSpan} it (e.g. a Fastify
 * request starts in `onRequest`, ends in `onResponse`). Prefer {@link withSpan}
 * for self-contained work.
 */
export function startSpan(name: string, attributes?: Attributes): Span {
  const correlationId = currentCorrelation().correlationId;
  const hasParent = trace.getSpan(context.active()) !== undefined;
  const span = getTracer().startSpan(name, {
    attributes: { ...attributes, 'harness.correlation_id': correlationId },
  });
  spanMeta.set(span, { isRoot: !hasParent, correlationId });
  return span;
}

/** End a span started by {@link startSpan}, writing through if it was a root. */
export function endSpan(span: Span): void {
  completeSpan(span);
}

/** Options for {@link withSpan}. */
export interface WithSpanOptions {
  readonly spanName: string;
  readonly attributes?: Attributes;
  /**
   * When given, run the span inside this correlation context (engines whose
   * work is driven by a poll loop or an event handler — no ambient context —
   * bind here). When omitted, the ambient {@link currentCorrelation} is used.
   */
  readonly ctx?: CorrelationCtx;
}

/**
 * Run `fn` inside a named span, ending it when `fn` settles (a rejection still
 * ends the span before propagating — a span must never swallow a failure).
 * The span is made the active span for its duration so descendant spans form a
 * correct parent/child lineage, and `harness.correlation_id` is always stamped.
 */
export async function withSpan<T>(opts: WithSpanOptions, fn: (span: Span) => Promise<T>): Promise<T> {
  const run = (): Promise<T> => startAndEnd(opts, fn);
  return opts.ctx ? runWithCorrelation(opts.ctx, run) : run();
}

/** Start, set active, run, write-through/end — the hand-rolled core of withSpan. */
async function startAndEnd<T>(opts: WithSpanOptions, fn: (span: Span) => Promise<T>): Promise<T> {
  const span = startSpan(opts.spanName, opts.attributes);
  try {
    return await context.with(trace.setSpan(context.active(), span), () => fn(span));
  } finally {
    completeSpan(span);
  }
}

/** Write through (root only), then end the span. Never throws to the caller. */
function completeSpan(span: Span): void {
  try {
    const meta = spanMeta.get(span);
    if (meta?.isRoot && writeThrough) {
      const sc = span.spanContext();
      writeThrough({
        trace_id: sc.traceId,
        span_id: sc.spanId,
        correlation_id: meta.correlationId,
      });
    }
  } catch {
    // A failed trace_correlation write must not break the pipeline.
  }
  span.end();
}

/** Read the span context (trace_id + span_id) of the *active* span, if any. */
export function activeSpanContext(): SpanContext | undefined {
  return trace.getSpan(context.active())?.spanContext() ?? undefined;
}

/**
 * Run `fn` with `span` as the active span. Used to make a long-lived span (e.g.
 * the Fastify `http.request` root, started in `onRequest`) the parent of every
 * span opened for the rest of the request. Equivalent to the auto-activation
 * `withSpan` does internally, but for externally-managed spans.
 */
export function activateSpan<T>(span: Span, fn: () => T): T {
  return context.with(trace.setSpan(context.active(), span), fn);
}

/** The singleton in-memory exporter, for tests asserting the span set. */
export function inMemoryExporter(): InMemorySpanExporter {
  if (!inMemory) {
    throw new Error('[observability] initTracing() must run before reading spans');
  }
  return inMemory;
}

/** Reset the provider + in-memory store (test isolation only). */
export function resetTracing(): void {
  provider = undefined;
  inMemory = undefined;
  writeThrough = undefined;
}
