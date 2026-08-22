/**
 * Prometheus-registry metrics tests (day-04 §3.5).
 *
 * Exercises the registry: counter increments + label splits, dwell histogram
 * buckets, offline-gauge `setGauge`, and the full Spec-11 inventory rendering as
 * Prometheus text with `# HELP`/`# TYPE` lines — the exact contract `/metrics`
 * serves.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  gauges,
  observeReviewDwell,
  recordRouted,
  recordUsefulness,
  register,
  resupply,
  reviewDwell,
  routed,
  setGauge,
  usefulness,
} from '../index.js';

/** Look up a metric component's current value by its label key/value. */
async function labelValue(
  name: string,
  label: string,
  labelValue: string,
): Promise<number | undefined> {
  const metric = register.getSingleMetric(name);
  const data = metric ? await metric.get() : undefined;
  return data?.values.find((p) => p.labels[label] === labelValue)?.value;
}

beforeEach(() => {
  // Reset in place (not register.clear(), which unregisters the module-level
  // singletons and leaves them orphaned for the rest of the file).
  routed.reset();
  usefulness.reset();
  reviewDwell.reset();
  resupply.reset();
  for (const gauge of gauges.values()) {
    gauge.reset();
  }
});

describe('counters', () => {
  it('routed splits on the bounded route label', async () => {
    recordRouted('human');
    recordRouted('human');
    recordRouted('auto_approvable');

    expect(await labelValue('harness_routing_items_total', 'route', 'human')).toBe(2);
    expect(await labelValue('harness_routing_items_total', 'route', 'auto_approvable')).toBe(1);
  });

  it('usefulness keeps true/false distinct and folds undefined into unknown', async () => {
    recordUsefulness(true);
    recordUsefulness(false);
    recordUsefulness(undefined);

    expect(await labelValue('harness_assessment_usefulness_total', 'was_useful', 'true')).toBe(1);
    expect(await labelValue('harness_assessment_usefulness_total', 'was_useful', 'false')).toBe(1);
    expect(await labelValue('harness_assessment_usefulness_total', 'was_useful', 'unknown')).toBe(
      1,
    );
  });

  it('resupply increments on each request', async () => {
    resupply.inc();
    resupply.inc();
    expect(await register.metrics()).toContain('harness_context_resupply_total 2');
  });
});

describe('review dwell histogram', () => {
  it('populates the claim -> decide seconds buckets', async () => {
    observeReviewDwell(45);
    observeReviewDwell(90);

    const text = await register.metrics();
    expect(text).toContain('# TYPE harness_review_dwell_seconds histogram');
    // 45s and 90s fall into the 60s and 120s buckets.
    expect(text).toContain('harness_review_dwell_seconds_bucket{le="60"} 1');
    expect(text).toContain('harness_review_dwell_seconds_bucket{le="120"} 2');
  });
});

describe('offline gauges', () => {
  it('setGauge sets the value and rejects unknown names', async () => {
    setGauge('harness_routing_precision', 0.9);

    expect(await register.metrics()).toContain('harness_routing_precision 0.9');
    expect(() => setGauge('harness_does_not_exist', 1)).toThrow(/unknown gauge/);
  });

  it('all six Spec-11 gauges are registered', () => {
    for (const name of [
      'harness_routing_precision',
      'harness_routing_recall',
      'harness_routing_escalation_leakage',
      'harness_attention_human_minutes_per_accept',
      'harness_attention_inflation_ratio',
      'harness_verification_false_pass_rate',
    ]) {
      expect(gauges.get(name), name).toBeDefined();
    }
  });
});

describe('prometheus text format', () => {
  it('renders the recorded metrics with HELP and TYPE lines', async () => {
    recordRouted('human');
    observeReviewDwell(60);
    recordUsefulness(true);

    const text = await register.metrics();
    expect(text).toContain('# HELP harness_routing_items_total');
    expect(text).toContain('# TYPE harness_routing_items_total counter');
    expect(text).toContain('harness_routing_items_total{route="human"} 1');
    expect(text).toContain('# TYPE harness_review_dwell_seconds histogram');
    expect(text).toContain('harness_assessment_usefulness_total{was_useful="true"} 1');
  });

  it('emits all ten metric names in the inventory', async () => {
    const text = await register.metrics();
    const names = [
      'harness_routing_items_total',
      'harness_routing_precision',
      'harness_routing_recall',
      'harness_routing_escalation_leakage',
      'harness_attention_human_minutes_per_accept',
      'harness_attention_inflation_ratio',
      'harness_review_dwell_seconds',
      'harness_assessment_usefulness_total',
      'harness_verification_false_pass_rate',
      'harness_context_resupply_total',
    ];
    for (const name of names) {
      expect(text).toContain(name);
    }
  });
});
