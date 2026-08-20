# Day 04 — Metrics: Routing, Review Dwell & Usefulness Counters

| | |
|---|---|
| **Week** | 1 — Identity & observability |
| **Spec refs** | Spec 11 §4.1 (routing quality), §4.2 (attention efficiency), Architecture §4.4 |
| **Estimated effort** | 7 hours |
| **Prerequisites** | Day 03 (OTel spans + `trace_correlation`); Phase-1 `/api/ops/metrics` + `assessment_feedback.was_useful` + `review_decisions` |

---

## 1. Objectives

By end of day you will have:

1. A **Prometheus metrics registry** in `packages/observability` (counters, gauges, histograms) named after the four Spec 11 dimensions: routing quality, attention efficiency, pipeline quality, context sufficiency.
2. **Review dwell** and **usefulness** counters wired to the actual decision path — measured, not inferred.
3. A `/metrics` scrape endpoint (Prometheus text format) replacing the Phase-1 hand-rolled `/api/ops/metrics`, plus **dashboard provisioning** (Grafana JSON) that renders the numbers operators asked for in Phase-1's audit cookbook.
4. A **naming convention** that makes every metric traceable to a Spec 11 definition — `harness_<dimension>_<measure>_<unit>`.

Phase 1 could answer "are we crying wolf?" with a SQL query. Phase 2 needs those answers as *continuous, alertable* metrics so calibration (Week 3) can be judged before/after — a metric that only exists in a SQL cookbook can't be plotted over time.

---

## 2. Design Decisions

### 2.1 Metric inventory (each keyed to its Spec 11 parent)

| Metric | Type | Definition (Spec 11) |
|--------|------|----------------------|
| `harness_routing_items_total{route}` | Counter | items routed to `human` vs `auto_approvable` |
| `harness_routing_precision` | Gauge | §4.1 precision on the rolling window |
| `harness_routing_recall` | Gauge | §4.1 recall (missed → later defect/rework) |
| `harness_routing_escalation_leakage` | Gauge | §4.1 auto-approvable-then-rejected |
| `harness_attention_human_minutes_per_accept` | Gauge | §4.2 human minutes / accepted change |
| `harness_attention_inflation_ratio{label}` | Gauge | §4.2 CRITICAL+HIGH share of assessments |
| `harness_review_dwell_seconds` | Histogram | queue→decide per item |
| `harness_assessment_usefulness_total{was_useful}` | Counter | review feedback: true/false splits |
| `harness_verification_false_pass_rate` | Gauge | §4.3 passed-but-later-defect |
| `harness_context_resupply_total` | Counter | §4.3 `requestAdditionalContext` triggers |

**Gauges vs counters rule:** a value computed offline (precision/recall, leakage) is a *gauge* — set to the latest window result, never incremented. A value emitted on a discrete event (a decision, an assessment) is a *counter* — incremented once. Mixing them corrupts the semantics and makes `rate()` meaningless on the Prometheus side.

### 2.2 Where counters are emitted — on the event path, not by polling

```typescript
// packages/observability/src/metrics.ts
export const metrics = {
  reviewDwell: createHistogram('harness_review_dwell_seconds', /* buckets */ [30,60,120,300,600,1800,3600]),
  usefulness:  createCounter('harness_assessment_usefulness_total', { labelNames: ['was_useful'] }),
  routed:      createCounter('harness_routing_items_total',  { labelNames: ['route'] }),
  resupply:    createCounter('harness_context_resupply_total'),
};
```

Emission sites (each publishes on the event, `correlation_id` bound, so every counter can be joined to a trace):

- `review.decision_submitted` → increment `usefulness{was_useful}` + observe `reviewDwell` (from `claimed_at → decided_at`).
- `attention.item_routed` (Phase-1 event) → increment `routed{route}` where route ∈ `{human, auto_approvable}`.
- `context.additional_requested` (new event, Phase-1 `requestAdditionalContext` path) → increment `resupply`.

Offline gauges (precision/recall/leakage/inflation/false-pass) are computed by `@harness/evaluation` on Day 06 and **set** on this same registry via `setGauge` — so the dashboard has one source, not two.

### 2.3 `/metrics` endpoint + registry lifetime

```typescript
// apps/api/src/routes/metrics.ts
fastify.get('/metrics', async (_req, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return register.metrics();
});
```

Default registry is process-global; the counter labels are bounded (route, was_useful), never user/email/task-id — a metric keyed on unbounded values is a cardinality bomb. We key only on categorical labels; drill-down joins happen in Grafana via `trace_correlation`/`review_decisions`, not via metric labels.

### 2.4 Dashboards as code

`infra/grafana/provisioning/dashboards/attention.json` — two panels to start: (1) routing funnel (items routed human vs auto per day), (2) usefulness ratio per label (the SQL from Phase-1 Q5, now as a time series). Provisioned from the repo so a clean `docker compose up` renders them.

---

## 3. Tasks

### 3.1 Metric definitions + registry (60 min)

- [ ] `packages/observability/src/metrics.ts` — implement §2.1's inventory with `prom-client`; export `register`, `metrics` object, and `setGauge(name, value, labels?)` helper.

### 3.2 Emit counters from the event path (90 min)

- [ ] `@harness/review` — dwell + usefulness on `review.decision_submitted`.
- [ ] `@harness/attention-engine` — `routed{route}` on `attention.item_routed` (route comes from the assessment's `review_required`/`AUTO_APPROVABLE` outcome).
- [ ] `@harness/context-engine` — emit `context.additional_requested` + increment `resupply` on the `requestAdditionalContext` path (Phase-1 seam).

### 3.3 `/metrics` endpoint (30 min)

- [ ] `apps/api/src/routes/metrics.ts` (§2.3); wire in `bootstrap.ts`; remove the old `/api/ops/metrics` JSON endpoint (or keep `/api/ops/health` only).

### 3.4 Dashboards (60 min)

- [ ] `infra/grafana/provisioning/*` — datasource (Prometheus self-scrape) + the two panels; add Grafana to `docker-compose.yml`.

### 3.5 Tests + verification (120 min)

- [ ] `packages/observability/src/__tests__/metrics.test.ts` — counter increments on emitted events (spy the bus), gauge set, histogram buckets populated.
- [ ] `apps/api` test — `/metrics` returns 200 text/plain and contains `harness_review_dwell_seconds`.
- [ ] Run a scripted review (one approve with `was_useful=true`, one reject `false`) and assert `harness_assessment_usefulness_total{was_useful="true"} == 1`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/observability/src/metrics.ts` | Registry + inventory + `setGauge` |
| `apps/api/src/routes/metrics.ts` | Prometheus scrape endpoint |
| `infra/grafana/provisioning/dashboards/attention.json` | Routing funnel + usefulness dashboards |
| `docker-compose.yml` (updated) | Grafana service |
| `packages/observability/src/__tests__/metrics.test.ts` | Emission/registry tests |

---

## 5. Acceptance Criteria

- [ ] `curl localhost:3000/metrics` returns `text/plain` containing all 10 metric families from §2.1 with `# HELP`/`# TYPE` lines.
- [ ] After one approve + one reject: `harness_assessment_usefulness_total{was_useful="true"} == 1` and `{was_useful="false"} == 1`.
- [ ] `harness_review_dwell_seconds` histogram has ≥1 observation, and its value is within `[claimed_at, decided_at]` window of the test item.
- [ ] `harness_routing_items_total{route="human"}` increments when a HIGH assessment routes to human.
- [ ] No metric label is keyed on `user_id`, `email`, `task_id`, or `correlation_id` (grep the `labels` columns for denial of the rule).
- [ ] `pnpm --filter @harness/observability test` — green; `pnpm lint` — no boundary violations.
- [ ] Grafana datasource + dashboard load against `docker compose up` with zero provisioning errors.

---

## 6. Notes & Pitfalls

- **Cardinality is the enemy.** Every label value becomes a Prometheus time series. Never label a metric with `correlation_id`, `task_id`, or `user_id` — add those as *span attributes* (Day 03) and join in dashboards. This is a hard rule, enforced by review + grep.
- **Don't compute precision on the hot path.** §4.1 precision/recall need the outcome (rejection/defect) which appears *later*. Guessing it per-event is wrong; express it as a gauge set by the offline evaluator (Day 06). Today's counters are the *raw* observed events, not the derived rates.
- **`was_useful` can be null.** Phase-1 decisions may carry `wasUseful` unset. Record `was_useful="unknown"` rather than silently folding nulls into `false` — `false` means "actively not useful", a different signal.
- **Counter increments must be idempotent-under-replay.** If the event bus re-delivers, the counter fires twice. Where possible key off the event `event_id` (already-deduplicated in `event_log`) — Day 08 (replay) will resurface this, so note it now.
- **Next (Day 05):** Week-1 checkpoint — identity + observability demonstrable on a live run before the evaluation work begins.

---

*Prev: [Day 3 — OpenTelemetry: Spans, trace_id ↔ correlation_id](day-03.md) | Next: [Day 5 — Week 1 Checkpoint: Identity & Observability](day-05.md)*
