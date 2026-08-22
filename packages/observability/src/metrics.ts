/**
 * `@harness/observability` metric registry + recorders (day-04 §2).
 *
 * The four Spec-11 dimensions (routing quality, attention efficiency, pipeline
 * quality, context sufficiency) are expressed on a **prom-client** register — the
 * same Prometheus text format Phase-1 asked for, but as continuous, alertable
 * metrics instead of SQL cookbooks (day-04 §1).
 *
 * Rules (day-04 §2):
 *  - **counters** fire on discrete events (a decision, an assessment); **gauges**
 *    are set offline by `@harness/evaluation` (Day 06) which needs *later* outcome
 *    (rejection/defect) to derive precision/recall/leakage — never guess these on
 *    the hot path.
 *  - labels are bounded categorical values (`route`, `was_useful`). **Never** key a
 *    label on `correlation_id`, `task_id`, or `user_id` — a cardinality bomb. Those
 *    live on span attributes (Day 03) and join to a metric via `trace_correlation`.
 *
 * Emission sites:
 *  - `ReviewService.decide` → observe `reviewDwell` + inc `usefulness{was_useful}`;
 *  - `AttentionRouter.route` → inc `routed{route}` (route = human | auto_approvable);
 *  - context-engine's resupply seam (Day-06) → inc `resupply` once it exists.
 */

import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/** The process-global registry scraped by the `/metrics` endpoint (day-04 §2.3). */
export const register = new Registry();

/** Items routed to review — `{route}` ∈ {human, auto_approvable}. */
export const routed = new Counter({
  name: 'harness_routing_items_total',
  help: 'Items routed to human vs auto_approvable review.',
  labelNames: ['route'] as const,
  registers: [register],
});

/** Reviewer usefulness signal — `{was_useful}` ∈ {true, false, unknown}. */
export const usefulness = new Counter({
  name: 'harness_assessment_usefulness_total',
  help: 'Reviewer usefulness feedback, by was_useful.',
  labelNames: ['was_useful'] as const,
  registers: [register],
});

/** Claim → decide latency, in seconds (bounded buckets for alerting). */
export const reviewDwell = new Histogram({
  name: 'harness_review_dwell_seconds',
  help: 'Review dwell: claim -> decide latency in seconds.',
  buckets: [30, 60, 120, 300, 600, 1800, 3600],
  registers: [register],
});

/** Context resupply — incremented on the requestAdditionalContext seam (Day 06). */
export const resupply = new Counter({
  name: 'harness_context_resupply_total',
  help: 'Times an agent requested additional context.',
  registers: [register],
});

/** Context source cache hit — a source served without re-reading from disk (§3.4). */
export const cacheHit = new Counter({
  name: 'harness_context_cache_hit_total',
  help: 'Context source cache hits (source served from the (source_id, content_hash) cache).',
  registers: [register],
});

/** Context source cache miss — a source was read from disk and (re)stored. */
export const cacheMiss = new Counter({
  name: 'harness_context_cache_miss_total',
  help: 'Context source cache misses (source read from disk).',
  registers: [register],
});

/**
 * Offline gauges, **set** (not incremented) by `@harness/evaluation` on Day 06.
 * Registered here so `/metrics` HELP lines exist for the whole Spec-11 inventory
 * and the dashboard has one source. An unset gauge emits no sample until set.
 */
const OFFLINE_GAUGES: ReadonlyArray<readonly [name: string, help: string]> = [
  ['harness_routing_precision', 'Routing precision on the rolling window (spec 11 §4.1).'],
  ['harness_routing_recall', 'Routing recall: missed attention -> later defect/rework.'],
  ['harness_routing_escalation_leakage', 'Auto-approvable-then-rejected changes.'],
  ['harness_attention_human_minutes_per_accept', 'Human minutes per accepted change (§4.2).'],
  ['harness_attention_inflation_ratio', 'CRITICAL+HIGH share of recent assessments (§4.2).'],
  ['harness_verification_false_pass_rate', 'Passed-but-later-defect rate (§4.3).'],
];

/** All registered gauges by metric name, for {@link setGauge}. */
export const gauges: ReadonlyMap<string, Gauge<string>> = new Map(
  OFFLINE_GAUGES.map(([name, help]) => [name, new Gauge({ name, help, registers: [register] })]),
);

/** Set an offline gauge to its latest computed window value. */
export function setGauge(name: string, value: number, labels?: Record<string, string>): void {
  const gauge = gauges.get(name);
  if (!gauge) {
    throw new Error(`[observability] unknown gauge "${name}"`);
  }
  if (labels) {
    gauge.set(labels, value);
  } else {
    gauge.set(value);
  }
}

/** A routing decision landed: `route` ∈ {human, auto_approvable}. */
export function recordRouted(route: 'human' | 'auto_approvable'): void {
  routed.inc({ route });
}

/** Observe claim → decide latency (already in seconds). */
export function observeReviewDwell(seconds: number): void {
  reviewDwell.observe(seconds);
}

/**
 * Count a usefulness verdict. `undefined` (a Phase-1 decision without the
 * signal) becomes `unknown` — never folded into `false`, which means "actively
 * not useful" (day-04 §6).
 */
export function recordUsefulness(wasUseful: boolean | undefined): void {
  usefulness.inc({ was_useful: wasUseful === undefined ? 'unknown' : String(wasUseful) });
}

/** Count a context-cache hit (a source served without a file read). */
export function recordCacheHit(): void {
  cacheHit.inc();
}

/** Count a context-cache miss (a source read from disk and stored). */
export function recordCacheMiss(): void {
  cacheMiss.inc();
}
