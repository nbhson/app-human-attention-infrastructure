/**
 * Tracing bootstrap for the API (day-03 §3.2).
 *
 * Layers the `trace_correlation` write-through onto the shared
 * `@harness/observability` provider. The insert is fire-and-forget and
 * conflict-ignored (those keys are unique per root span): a failed trace write
 * must never break the request that produced it (§6 pitfalls).
 */

import { TOKENS } from '@harness/di';
import type { Container, Logger } from '@harness/di';
import { traceCorrelation } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { initTracing } from '@harness/observability';
import type { TraceCorrelationRow } from '@harness/observability';

/** Build + register the OTel provider, wiring `trace_correlation` write-through. */
export function initApiTracing(container: Container): void {
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const logger = container.resolve<Logger>(TOKENS.Logger);

  initTracing({
    // OTLP export is opt-in via env; otherwise devs and tests use the in-memory
    // sink (day-03 §2.5). OTel's own exporter swallows batch errors.
    ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? { otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }
      : {}),
    console: process.env.OTEL_CONSOLE === 'true',
    // One row per ROOT span (day-03 §2.3); onConflictDoNothing keeps a re-run
    // idempotent. Errors are logged and dropped — never rethrown.
    writeThrough: (row: TraceCorrelationRow) => {
      void db
        .insert(traceCorrelation)
        .values(row)
        .onConflictDoNothing()
        .catch((error: unknown) => {
          logger.error('[trace] trace_correlation write failed', { error: String(error) });
        });
    },
  });
}
