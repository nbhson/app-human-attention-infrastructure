# Day 04 — Metrics: Routing, Review Dwell & Usefulness Counters

| | |
|---|---|
| **Week** | W1 — Identity & observability |
| **Spec refs** | Spec 11 §4.1 (routing quality), §4.2 (attention efficiency), Architecture §4.4 |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 03 (OTel spans + `trace_correlation`); Phase-1 `/api/ops/metrics` + `assessment_feedback.was_useful` + `review_decisions` |

---

## 1. Objectives

By end of day you will have:

1. A **Prometheus metrics registry** in `packages/observability` (counters, gauges, histograms) named after the four Spec 11 dimensions: routing quality, attention efficiency, pipeline quality, context sufficiency.
2. **Review dwell** and **usefulness** counters wired to the actual decision path — measured, not inferred.
3. A `/metrics` scrape endpoint (Prometheus text format) replacing the hand-rolled `/api/ops/metrics`, plus **dashboard provisioning** (Grafana JSON).
4. A **naming convention** making every metric traceable to a Spec 11 definition — `harness_<dimension>_<measure>_<unit>`.

Phase 1 could answer "are we crying wolf?" with a SQL query. Phase 2 needs those answers as *continuous, alertable* metrics so calibration (Week 3) can be judged before/after.

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
| `harness_assessment_usefulness_total{was_useful}` | Counter | review feedback true/false splits |
| `harness_verification_false_pass_rate` | Gauge | §4.3 passed-but-later-defect |
| `harness_context_resupply_total` | Counter | §4.3 `requestAdditionalContext` triggers |

**Gauges vs counters rule:** a value computed offline (precision/recall, leakage) is a *gauge* — set to the latest window result, never incremented. A value emitted on a discrete event is a *counter* — incremented once.

### 2.2 Where counters are emitted — on the event path, not by polling

- `review.decision_submitted` → increment `usefulness{was_useful}` + observe `reviewDwell` (from `claimed_at → decided_at`).
- `attention.item_routed` → increment `routed{route}` where route ∈ `{human, auto_approvable}`.
- `context.additional_requested` → increment `resupply`.

Offline gauges (precision/recall/leakage/inflation/false-pass) are computed by `@harness/evaluation` on Day 06 and **set** on this same registry via `setGauge` — one source, not two.

### 2.3 `/metrics` endpoint + registry lifetime

Default registry is process-global; counter labels are bounded (route, was_useful), never user/email/task-id — a metric keyed on unbounded values is a cardinality bomb. Drill-down joins happen in Grafana via `trace_correlation`/`review_decisions`, not metric labels.

### 2.4 Dashboards as code

`infra/grafana/provisioning/dashboards/attention.json` — two panels: (1) routing funnel (items routed human vs auto per day), (2) usefulness ratio per label. Provisioned from the repo so `docker compose up` renders them.

---

## 3. Tasks

### 3.1 Metric definitions + registry (60 min)
- [ ] `packages/observability/src/metrics.ts` — §2.1 inventory with `prom-client`; export `register`, `metrics`, `setGauge`.

### 3.2 Emit counters from the event path (90 min)
- [ ] `@harness/review` — dwell + usefulness on `review.decision_submitted`.
- [ ] `@harness/attention-engine` — `routed{route}` on `attention.item_routed`.
- [ ] `@harness/context-engine` — emit `context.additional_requested` + increment `resupply`.

### 3.3 `/metrics` endpoint (30 min)
- [ ] `apps/api/src/routes/metrics.ts` — Prometheus scrape; wire in `bootstrap.ts`; keep only `/api/ops/health` of the old endpoints.

### 3.4 Dashboards (60 min)
- [ ] `infra/grafana/provisioning/*` — datasource + two panels; add Grafana to `docker-compose.yml`.

### 3.5 Tests + verification (120 min)
- [ ] Counter increments on emitted events (spy the bus), gauge set, histogram buckets populated.
- [ ] `/metrics` returns 200 text/plain containing `harness_review_dwell_seconds`.
- [ ] One approve (`was_useful=true`) + one reject (`false`) → `…usefulness_total{was_useful="true"} == 1`.

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

- [ ] `curl localhost:3000/metrics` returns `text/plain` containing all 10 metric families with `# HELP`/`# TYPE`.
- [ ] After one approve + one reject: `usefulness_total{was_useful="true"} == 1` and `{was_useful="false"} == 1`.
- [ ] `harness_review_dwell_seconds` has ≥1 observation within the test item's `[claimed_at, decided_at]` window.
- [ ] `harness_routing_items_total{route="human"}` increments on a HIGH-assessment route.
- [ ] No metric label keys on `user_id`, `email`, `task_id`, or `correlation_id`.
- [ ] `pnpm --filter @harness/observability test` green; `pnpm lint` no boundary violations.
- [ ] Grafana loads against `docker compose up` with zero provisioning errors.

---

## 6. Notes & Pitfalls

- **Cardinality is the enemy.** Every label value is a time series. Never label with `correlation_id`/`task_id`/`user_id` — put those on span attributes (Day 03) and join in dashboards.
- **Don't compute precision on the hot path.** Precision/recall need the *outcome* (rejection/defect) which appears later; express them as gauges set by the offline evaluator (Day 06).
- **`was_useful` can be null.** Record `was_useful="unknown"` rather than folding nulls into `false`.
- **Counter increments must be idempotent-under-replay.** Key off the event `event_id` (deduplicated in `event_log`); Day 08 replay will resurface this.
- **Next (Day 05):** Week-1 checkpoint — identity + observability demonstrable on a live run.

---

*Prev: [Day 03 — OpenTelemetry: Spans, trace_id ↔ correlation_id](day-03.md) | Next: [Day 05 — Week 1 Checkpoint: Identity & Observability](day-05.md)*