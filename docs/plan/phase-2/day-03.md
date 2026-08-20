# Day 03 — OpenTelemetry: Spans, trace_id ↔ correlation_id

| | |
|---|---|
| **Week** | 1 — Identity & observability |
| **Spec refs** | Architecture §4.4 (everything observable), §16 (event-driven model), Spec 2 §8 (event envelope / `correlation_id`) |
| **Estimated effort** | 7 hours |
| **Prerequisites** | Day 02 (role enforcement + `event_log.actor_id`); Phase-1 `correlation_id` already threads task → events → LLM → verification → review |

---

## 1. Objectives

By end of day you will have:

1. A new **`packages/observability`** that owns the OpenTelemetry SDK: a shared `Tracer` and `Meter` provider, plus a `withSpan` helper built around async-local context so spans auto-link to the in-flight `correlation_id`.
2. **Spans across the pipeline** — API request → orchestrator dispatch → agent run → LLM call → verification → review — each named consistently (`task.dispatch`, `llm.completion`, `verification.run`, `review.decide`).
3. A **verified `trace_id ↔ correlation_id` mapping** — one direction on the span attribute, the reverse direction for operators via a write-through table so a support query can start from either ID.
4. A **propagation test** that proves every span in an E2E run carries the same `correlation_id` and that the mapping row exists.

Phase 1 answered "what happened" with `correlation_id`; Phase 2 must answer "and how long did each hop take, end-to-end". OTel is the substrate for the Week-2 efficiency metrics (dwell, LLM cost, verification latency).

---

## 2. Design Decisions

### 2.1 Async-local context is the seam between spans and `correlation_id`

A span does not know about a harness task unless we tell it. Use `AsyncLocalStorage` to carry `{ correlationId, taskId }` through the request lifecycle, and bind it to the OTel context at request entry:

```typescript
// packages/observability/src/context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export const correlationStore = new AsyncLocalStorage<CorrelationCtx>();

export function runWithCorrelation<T>(ctx: CorrelationCtx, fn: () => T): T {
  return correlationStore.run(ctx, fn);
}
export function currentCorrelation(): CorrelationCtx {
  return correlationStore.getStore() ?? { correlationId: 'bootstrap' };
}
```

```typescript
// packages/observability/src/tracer.ts
import { trace, context } from '@opentelemetry/api';

export function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  const tracer = trace.getTracer('harness');
  const { correlationId } = currentCorrelation();      // read async-local, NOT console arg
  return tracer.startActiveSpan(name, (span) => {
    span.setAttribute('harness.correlation_id', correlationId);
    return fn(span).finally(() => span.end());
  });
}
```

**Why async-local, not passing IDs through every signature?** The Phase-1 code already passes `correlation_id` into event payloads; forcing every method to carry an extra parameter for tracing would be a wide, noisy change. Async-local keeps the existing signatures intact while making the correlation available *at the point the span is started*.

### 2.2 Span map — what gets instrumented

| Span | Package | Key attributes |
|------|---------|----------------|
| `http.request` | `apps/api` | `http.method`, `http.route`, `correlation_id` |
| `task.dispatch` | `@harness/orchestrator` | `task_id`, `attempt_number` |
| `agent.run` | `@harness/agent-runtime` | `run_id`, `agent_type`, `model` |
| `llm.completion` | `@harness/agent-runtime` | `model`, `prompt_hash`, `tokens_in`, `tokens_out` |
| `verification.run` | `@harness/verification-engine` | `change_id`, `check_kind` |
| `attention.assess` | `@harness/attention-engine` | `change_id`, `label` |
| `review.decide` | `@harness/review` | `queue_id`, `decision` |

### 2.3 The reverse mapping — a write-through `trace_correlation` table

The span attribute answers "given a trace, what was the correlation ID?" Operators also need the reverse ("given a task, which trace produced it?"). Write one row per root span *at request start*:

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

Write-through happens in the `http.request` instrumenter (root span only), not on every child span — child spans read `correlation_id` from `currentCorrelation()` and set it as an attribute; they do **not** each write a DB row.

### 2.4 Boundary rule — observability is cross-cutting infra

`packages/observability` imports `@harness/domain`, `@harness/db`, `@harness/di`. Engines are extended to import `@harness/observability` (an infra dependency, in the same tier as `db`/`di`) — but **still never each other**. Add `observability` to the ESLint `infra` element and to the engine allowlist, and extend the Day-05 architecture test to assert the new rule (R8).

### 2.5 Exporter choice — OTLP, nullable in dev

Default sink is OTLP/HTTP to a collector (env `OTEL_EXPORTER_OTLP_ENDPOINT`). When unset, use the **in-memory span processor** used by tests — devs get spans in the test runner without standing up a collector. Export to stdout JSON is a deliberate non-goal (Phase-1 `pino` logs stay the text transport; spans stay in OTLP).

---

## 3. Tasks

### 3.1 Scaffold `packages/observability` (45 min)

- [ ] `package.json` — `@harness/observability`; deps: `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-pg`.
- [ ] `src/context.ts` + `src/tracer.ts` + `src/meter.ts` (meter is a stub today; Day 04 fills it) + `src/index.ts`.

### 3.2 SDK bootstrap (45 min)

- [ ] `apps/api/src/observability.ts` — `initTracing()`: build the provider, register HTTP + pg instrumentation, set up the root-span write-through to `trace_correlation` (§2.3).
- [ ] Call `initTracing()` as the first line of `apps/api/src/index.ts`.

### 3.3 Instrument the pipeline (120 min)

- [ ] `apps/api` — wrap route handlers in `http.request` spans (or rely on http-instrumentation) + `runWithCorrelation` for the request id.
- [ ] `@harness/orchestrator` — `task.dispatch` span around the dispatch method; read correlation from the incoming event.
- [ ] `@harness/agent-runtime` — `agent.run` + `llm.completion` spans (reuse `request_hash`/tokens already logged in `llm_call_log`).
- [ ] `@harness/verification-engine` — `verification.run` span per check kind.
- [ ] `@harness/attention-engine` — `attention.assess` span; `@harness/review` — `review.decide` span.

### 3.4 The propagation test (90 min)

- [ ] `apps/api/src/__tests__/otel-propagation.test.ts` — run the happy-path E2E, then:
  - assert every collected span (in-memory processor) carries `harness.correlation_id` == the task's id;
  - assert `trace_correlation` has exactly one row for the root trace and its `correlation_id` matches;
  - assert child spans reference the root `trace_id` (trace lineage, not orphan spans).

### 3.5 Boundary + migration verification (60 min)

- [ ] Migration `0103_otel.sql` applies; `psql \d trace_correlation` shows the PK + reverse index.
- [ ] Update ESLint boundaries + Day-05 architecture test for R8 (engines may import `observability`; `observability` imports only domain/db/di).
- [ ] `docs/architecture/wiring-map.md` — log `TOKENS.Tracer`, `TOKENS.Meter`.

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
- [ ] `pnpm --filter @harness/orchestrator test`, `…agent-runtime`, `…verification-engine`, `…review` — still green after instrumentation (spanning must not change behavior).
- [ ] Propagation test passes: one `correlation_id` across all spans of an E2E run; `trace_correlation` row exists and reverse-lookups by `correlation_id`.
- [ ] `grep -r "trace_id" packages` — the only real trace writes are in `observability`; engines set attributes via the helper, not raw `trace.setSpan` everywhere.
- [ ] `psql \d trace_correlation` shows `trace_id`, `span_id`, `correlation_id` with the reverse index.
- [ ] No engine imports another engine (architecture test still asserts R4 after the R8 addition).

---

## 6. Notes & Pitfalls

- **`trace_id` is not `correlation_id`.** One task can span multiple traces (a re-dispatched attempt, a resume); one trace can carry multiple correlation ids (a request that fans out). Don't collapse them — the mapping table is a join, not a rename. This is the single most common Phase-2 confusion; keep §2.3's table authoritative.
- **Do not write a `trace_correlation` row per child span.** Only the root span writes through; child-span writes would turn a low-volume audit table into a high-volume hot path.
- **Async-local leaks across `await` are fine; leaks across process are not.** Ensure the worker/subscribe boundaries (event-handler callbacks) re-establish context — the `runWithCorrelation` wrapper is the only sanctioned entry point.
- **Spans must never change the control flow.** A span that swallows an exception or a failed export that throws into the pipeline is worse than no telemetry. Export errors are logged and dropped, never rethrown.
- **The in-memory exporter is for tests only.** If you point a test at a live collector, your CI becomes dependent on a network service. Keep the test path deterministic.
- **Next (Day 04):** Prometheus metrics — routing precision/recall, review dwell, usefulness counters — endpoints + dashboards on top of this tracing substrate.

---

*Prev: [Day 2 — AuthZ: Reviewer Roles, Endpoint Enforcement & Audit Identity](day-02.md) | Next: [Day 4 — Metrics: Routing, Review Dwell & Usefulness Counters](day-04.md)*
