# Observability

> **Endpoint:** `GET /metrics` (Prometheus text, no auth) — `apps/api/src/routes/metrics.ts` over `@harness/observability`'s process-global `register`. Traces via OpenTelemetry + `trace_correlation` write-through (`packages/db/src/schema/trace-correlation.ts`).

## Metric inventory

All names are `harness_*` (`packages/observability/src/metrics.ts`). Counters emit on each event; gauges are set offline by `@harness/evaluation` (Day 06) and show no sample until set.

### Counters / histograms (hot path)

| Metric | Type | Labels | When it fires | Alert hint |
|---|---|---|---|---|
| `harness_routing_items_total` | Counter | `route ∈ {human, auto_approvable}` | `AttentionRouter.route` | `increase(...[5m]) == 0` → router stalled |
| `harness_assessment_usefulness_total` | Counter | `was_useful ∈ {true,false,unknown}` | `ReviewService.decide` (`wasUseful` feedback) | `was_useful=false / total > 0.5` for 2w → R5 |
| `harness_review_dwell_seconds` | Histogram | — | claim → decide latency | `histogram_quantile(0.95, ...) > 3600` → queue not draining (R2) |
| `harness_context_resupply_total` | Counter | — | Agent asks for more context | High rate → context budget too tight |
| `harness_context_cache_hit_total` | Counter | — | Source served from `(source_id, content_hash)` cache | `hit/(hit+miss) < 0.5` → cache thrash |
| `harness_context_cache_miss_total` | Counter | — | Source read from disk | — |
| `harness_context_semantic_fallback_total` | Counter | — | Shadow semantic rank degraded to keyword (embedder down) | `increase(...[10m]) > 0` → R9 SemanticFallbackSustained |
| `harness_object_store_fallback_total` | Counter | — | Write degraded to inline DB | `increase(...[10m]) > 0` → R9 ObjectStoreFallbackSustained |
| `harness_object_store_error_total` | Counter | — | Store unavailable (fail-closed) | `increase(...[10m]) > 0` → R9 ObjectStoreErrorSustained (worse) |
| `harness_object_store_integrity_error_total` | Counter | — | SHA-256 read-back drift | `increase(...[1m]) > 0` → **data-integrity incident** (R9) |
| `harness_sandbox_run_total` | Counter | — | Sandboxed verification completed | — |
| `harness_sandbox_fallback_total` | Counter | — | Fell back to in-process (Docker/image down) | `increase(...[10m]) > 0` → R9 SandboxFallbackSustained |
| `harness_sandbox_duration_seconds` | Histogram | — | Sandbox run latency | `histogram_quantile(0.95, ...) > 60` → VERIFY_CLONE_TIMEOUT_S too low |

### Gauges (offline, set by evaluation)

| Gauge | Help |
|---|---|
| `harness_routing_precision` | Rolling-window precision (spec 11 §4.1) |
| `harness_routing_recall` | Missed attention → later defect/rework |
| `harness_routing_escalation_leakage` | Auto-approvable then rejected |
| `harness_attention_human_minutes_per_accept` | Human minutes per accepted change (§4.2) |
| `harness_attention_inflation_ratio` | CRITICAL+HIGH share of recent assessments (§4.2) |
| `harness_verification_false_pass_rate` | Passed-but-later-defect (§4.3) |

See `packages/observability/README.md` for the full spec-11 mapping.

## Tracing

- Provider initialized once at boot (`apps/api/src/observability.ts` `initApiTracing`); `registerTraceHook` wraps every request in `http.request` span (`apps/api/src/trace.ts`).
- Correlation propagates via `AsyncLocalStorage` (`packages/observability/src/context.ts` `runWithCorrelation`/`currentCorrelation`); join to `event_log` via `trace_correlation` table so `GET /api/audit` can render span + event in one timeline.
- `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` forwarded to the OTel SDK when set.

## Prometheus setup

```sh
# 1. Start Prometheus with the shipped config
prometheus --config.file=./prometheus.yml

# 2. Verify scrape
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job, health, lastError}'

# 3. Or hit the harness directly
curl -s http://localhost:3000/metrics | head -30
```

Config: `prometheus.yml` (scrapes `localhost:3000/metrics` every 15s; add replicas only after reading `docs/runbook/limitations.md` §1).

## PromQL snippets

```promql
# Queue health
sum(increase(harness_routing_items_total[5m])) by (route)
histogram_quantile(0.95, rate(harness_review_dwell_seconds_bucket[5m]))

# Usefulness (R5)
sum(rate(harness_assessment_usefulness_total{was_useful="false"}[1h]))
/ sum(rate(harness_assessment_usefulness_total[1h]))

# Cache efficiency
sum(rate(harness_context_cache_hit_total[5m]))
/ (sum(rate(harness_context_cache_hit_total[5m])) + sum(rate(harness_context_cache_miss_total[5m])))

# Degradation (R9 — copy-paste from runbook)
harness_context_semantic_fallback_total
harness_object_store_fallback_total
harness_object_store_error_total
harness_object_store_integrity_error_total
harness_sandbox_fallback_total
```

Thresholds are yours to tune — see `docs/runbook/README.md` R9; the harness ships counters, not opinionated alerts.

## Grafana (optional)

Import any Prometheus datasource pointing at `http://localhost:9090` and create panels for the counters/histograms above. No bundled dashboard is shipped — the metric names are stable (`packages/observability/src/metrics.ts` is the source of truth).

## Related docs

- `packages/observability/README.md` — spec-11 dimensions + span/gauge contract
- `docs/runbook/README.md` R9 — degradation fallback alerts (the operational view)
- `docs/runbook/audit-queries.md` — SQL audit beyond metrics
- `docs/architecture/runtime-startup.md` — when OTel is initialized
