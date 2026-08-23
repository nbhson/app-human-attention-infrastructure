# Day 03 — OpenTelemetry: Spans, trace_id ↔ correlation_id

| | |
|---|---|
| **Week** | W1 — Identity & observability |
| **Spec refs** | Architecture §4.4 (everything observable), §16 (event-driven model), Spec 2 §8 (event envelope / `correlation_id`) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 02 (role enforcement + `event_log.actor_id`); Phase-1 `correlation_id` already threads task → events → review → verification flow |

---

## 1. Objectives

By end of day you will have:

1. A new **`packages/observability`** owning the OpenTelemetry SDK: a shared `Tracer`/`Meter` provider plus a `withSpan` helper built around async-local context so spans auto-link to the in-flight `correlation_id`.
2. **Spans across the pipeline** — API request → task lifecycle → review generation → LLM completion → verification → review decision — each named consistently (`task.process`, `review.generate`, `llm.completion`, `verification.run`, `review.decide`).
3. A **verified `trace_id ↔ correlation_id` mapping** — one direction as a span attribute, the reverse direction via a write-through table for operators.
4. A **propagation test** proving every span in an E2E run carries the same `correlation_id` and that the mapping row exists.

Phase 1 answered "what happened" with `correlation_id`; Phase 2 must answer "and how long did each hop take, end-to-end". OTel is the substrate for the Week-2 efficiency metrics (dwell, LLM cost, verification latency).

---

## 2. Design Decisions

### 2.1 Async-local context is the seam between spans and `correlation_id`

A span does not know about a harness task unless we tell it. Use `AsyncLocalStorage` to carry `{ correlationId, taskId }` through the request lifecycle, binding it to the OTel context at request entry.

```typescript
// packages/observability/src/tracer.ts
import { trace } from '@opentelemetry/api';

export function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  const tracer = trace.getTracer('harness');
  const { correlationId } = currentCorrelation();      // read async-local, NOT a console arg
  return tracer.startActiveSpan(name, (span) => {
    span.setAttribute('harness.correlation_id', correlationId);
    return fn(span).finally(() => span.end());
  });
}
```

**Why async-local, not passing IDs through every signature?** Phase-1 already passes `correlation_id` into event payloads; forcing every method to carry an extra tracing parameter would be a wide, noisy change. Async-local keeps signatures intact while making the correlation available at the point the span starts.

### 2.2 Span map — what gets instrumented

| Span | Package | Key attributes |
|------|---------|----------------|
| `http.request` | `apps/api` | `http.method`, `http.route`, `correlation_id` |
| `task.process` | `@harness/orchestrator` | `task_id`, `attempt_number` |
| `review.generate` | `@harness/agent-runtime` (ReviewAgent) | `task_id`, `model` |
| `llm.completion` | `@harness/agent-runtime` | `model`, `prompt_hash`, `tokens_in`, `tokens_out` |
| `verification.run` | `@harness/verification-engine` | `change_id`, `check_kind` |
| `attention.assess` | `@harness/attention-engine` | `change_id`, `label` |
| `review.decide` | `@harness/review` | `queue_id`, `decision` |

The reviewer is the read-only `ReviewAgent` (report + findings + fix suggestions) that calls the `LLMProvider`; each is spanned separately so LLM cost is distinct from review assembly.

### 2.3 The reverse mapping — a write-through `trace_correlation` table

```sql
-- packages/db/migrations/0103_otel.sql
CREATE TABLE trace_correlation (
  trace_id       text NOT NULL,
  span_id        text NOT NULL,
  correlation_id text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trace_id, span_id)
);
CREATE INDEX trace_correlation_correlation_idx ON trace_correlation(correlation_id);
```

Write-through happens on the **root span only** (`http.request`); child spans read `correlation_id` from `currentCorrelation()` and set it as an attribute — they do not each write a DB row.

### 2.4 Boundary rule — observability is cross-cutting infra

`packages/observability` imports `@harness/domain`, `@harness/db`, `@harness/di`. Engines are extended to import `@harness/observability` (an infra dependency, same tier as `db`/`di`) — **never each other**. Add it to the ESLint `infra` element and the Day-05 architecture test (R8).

### 2.5 Exporter choice — OTLP, nullable in dev

Default sink is OTLP/HTTP to a collector (`OTEL_EXPORTER_OTLP_ENDPOINT`). When unset, use the in-memory span processor used by tests — devs get spans without a collector. Exporting to stdout JSON is a non-goal (pino stays the text transport).

---

## 3. Tasks

### 3.1 Scaffold `packages/observability` (45 min)
- [ ] `package.json` (`@harness/observability`); deps: OTel API/SDK-trace/SDK-metrics/OTLP-http + http & pg instrumentation.
- [ ] `src/context.ts` + `src/tracer.ts` + `src/meter.ts` (meter stub today; Day 04 fills it) + `src/index.ts`.

### 3.2 SDK bootstrap (45 min)
- [ ] `apps/api/src/observability.ts` — `initTracing()`: provider, http + pg instrumentation, root-span write-through (§2.3).
- [ ] Call `initTracing()` as the first line of `apps/api/src/index.ts`.

### 3.3 Instrument the pipeline (120 min)
- [ ] `apps/api` — `http.request` spans + `runWithCorrelation`.
- [ ] `@harness/orchestrator` — `task.process` span around the task lifecycle step.
- [ ] `@harness/agent-runtime` — `review.generate` + `llm.completion` spans (reuse tokens already logged in `llm_call_log`).
- [ ] `@harness/verification-engine` — `verification.run`; `@harness/attention-engine` — `attention.assess`; `@harness/review` — `review.decide`.

### 3.4 The propagation test (90 min)
- [ ] `apps/api/src/__tests__/otel-propagation.test.ts` — happy-path E2E, then assert: every span carries `harness.correlation_id`; `trace_correlation` has one root row with matching id; child spans reference the root `trace_id`.

### 3.5 Boundary + migration verification (60 min)
- [ ] Migration `0103_otel.sql` applies; `\d trace_correlation` shows PK + reverse index.
- [ ] ESLint boundaries + architecture test for R8; `docs/architecture/wiring-map.md` logs `TOKENS.Tracer`/`TOKENS.Meter`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/observability/src/{context,tracer,meter}.ts` | OTel wrapper + async-local correlation |
| `apps/api/src/observability.ts` | `initTracing()` bootstrap |
| `packages/db/migrations/0103_otel.sql` | `trace_correlation` table |
| `apps/api/src/__tests__/otel-propagation.test.ts` | span ↔ correlation_id invariant |
| ESLint boundary config + architecture test (updated) | R8 |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/observability test` — tracer/context unit tests pass.
- [ ] `pnpm --filter @harness/orchestrator test`, `…agent-runtime`, `…verification-engine`, `…review` — still green after instrumentation.
- [ ] Propagation test passes: one `correlation_id` across all spans; `trace_correlation` row exists and reverse-lookups by `correlation_id`.
- [ ] `grep -r "trace_id" packages` — the only real trace writes are in `observability`.
- [ ] `psql \d trace_correlation` shows the three columns with the reverse index.
- [ ] No engine imports another engine (architecture test still asserts R4 after R8).

---

## 6. Notes & Pitfalls

- **`trace_id` is not `correlation_id`.** One task can span multiple traces (a re-run, a resume); one trace can carry multiple correlation ids. Don't collapse them — the mapping table is a join, not a rename.
- **Do not write a `trace_correlation` row per child span.** Only the root span writes through; child-span writes turn a low-volume audit table into a hot path.
- **Async-local leaks across `await` are fine; leaks across process are not.** Re-establish context at worker/subscribe boundaries — `runWithCorrelation` is the only sanctioned entry point.
- **Spans must never change control flow.** A span that swallows an exception, or a failed export that throws, is worse than no telemetry. Export errors are logged and dropped.
- **The in-memory exporter is for tests only.** Pointing a test at a live collector makes CI depend on a network service.
- **Next (Day 04):** Prometheus metrics — routing precision/recall, review dwell, usefulness counters — endpoints + dashboards on this tracing substrate.

---

*Prev: [Day 02 — AuthZ: Reviewer Roles, Endpoint Enforcement & Audit Identity](day-02.md) | Next: [Day 04 — Metrics: Routing, Review Dwell & Usefulness Counters](day-04.md)*