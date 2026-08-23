# @harness/observability — OpenTelemetry Substrate & Pipeline Metrics

The tracing + metrics substrate that turns the pipeline's events into spans and
Prometheus metrics, all joinable back to one `correlation_id`.

**Status:** Phase 2 (Day 03–04) complete (as-built) ·
**Boundary rule:** shared package (R8) — imports only `@harness/domain`, `@harness/db`, `@harness/di`; provides no business logic.

---

## Purpose

1. **Own tracing** — tracer providers, spans, and the in-memory exporter.
2. **Own the correlation context** — async-local `correlation_id` linking spans to the in-flight request.
3. **Own meters & metrics** — Prometheus metrics with a `record*` helper per meaningful event.
4. **Reconstruct runs** — rebuild a full run's timeline from telemetry.

---

## Correlation model

```text
            correlation_id  (async-local context, task lifecycle id)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
    trace (span)           event_log row
        │                       │
        └──────▶ trace_correlation ◀──────┘
                (reverse map: either direction joins)
```

`correlation_id` **is** the task lifecycle id that `event_log` records, so traces
and the event log reconcile by construction. Every async worker re-establishes
context via `runWithCorrelation` before starting spans; a stray span is stamped
`bootstrap`, never silently correlated.

---

## Metrics discipline

- **Recorded with `record*` helpers** — e.g. routing (`recordRouted`), review
  dwell (`observeReviewDwell`), usefulness (`recordUsefulness`), cache
  (`cacheHit`/`cacheMiss`), sandbox (`sandboxRun`), object-store errors,
  semantic fallback, and integrity.
- **Bounded cardinality.** Labels are categorical; `correlation_id`/`task_id`/
  `user_id` ride span attributes, never metric labels.
- **Honesty over completeness.** A `record*` helper omits a metric on a zero
  denominator rather than emitting `NaN`/`Infinity`.

---

## E2E reconstruction

`e2e/reconstruct.ts` (`reconstruct`) rebuilds a `ReconstructedRun` from stored
telemetry, and raises `TelemetryIntegrityError` when the timeline doesn't hold —
the self-check that proves the substrate is honest.

---

## Modules

| Module | What it provides |
| --- | --- |
| `context.ts` | `runWithCorrelation` / `currentCorrelation`. |
| `tracer.ts` | `initTracing`, `getTracer`, `startSpan`/`endSpan`/`withSpan`, `inMemoryExporter`, `resetTracing`. |
| `meter.ts` | `getMeter`, `setMeterName`. |
| `metrics.ts` | Named counters/gauges + the `record*` helpers. |
| `e2e/reconstruct.ts` | `reconstruct` + `TelemetryIntegrityError`. |

---

## Interaction with other packages

```text
        all engines ──(withSpan / runWithCorrelation)──▶ observability
        observability ──(spans/metrics joinable by correlation_id)──▶ /metrics
```

Engines instrument by importing `withSpan` / `runWithCorrelation` — they never
touch the OTel API directly. This package provides no business logic and imports
nothing downstream.

---

## Directory structure

```
src/
├── index.ts
├── context.ts
├── tracer.ts
├── meter.ts
├── metrics.ts
└── e2e/reconstruct.ts
```

## Public API surface

```typescript
// runWithCorrelation, currentCorrelation
// initTracing, getTracer, startSpan, endSpan, withSpan, inMemoryExporter, resetTracing
// getMeter, setMeterName
// metrics record* helpers
// reconstruct, TelemetryIntegrityError
```

## Wiring

`initTracing`/meter registration happen in `apps/api/src/bootstrap.ts`; the
`/metrics` scrape endpoint lives in `apps/api/src/routes/metrics.ts`.