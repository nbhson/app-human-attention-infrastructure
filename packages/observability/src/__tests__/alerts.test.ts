import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Day-26 §3.5 alert-governance test: every Day-26 degradation contract has a
 * corresponding Prometheus alert, and the alert file is *imported* by the scrape
 * config (`rule_files`). A fallback that pages is "loud"; a counter nobody
 * alerts on is just a nice hat on a silent failure (Spec 10).
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const ALERTS = fileURLToPath(new URL('../../../../infra/prometheus/alerts.yml', import.meta.url));
const PROMETHEUS = fileURLToPath(
  new URL('../../../../infra/prometheus/prometheus.yml', import.meta.url),
);

/** The Day-26/§2.1 degradation counters — each must have an alert rule. */
const DEGRADATION_METRICS: ReadonlyArray<{ counter: string; metric: string }> = [
  { counter: 'semanticFallback', metric: 'harness_context_semantic_fallback_total' },
  { counter: 'objectStoreFallback', metric: 'harness_object_store_fallback_total' },
  { counter: 'objectStoreError', metric: 'harness_object_store_error_total' },
  { counter: 'objectIntegrityError', metric: 'harness_object_store_integrity_error_total' },
  { counter: 'sandboxFallback', metric: 'harness_sandbox_fallback_total' },
];

function alertsFile(): string {
  return readFileSync(ALERTS, 'utf8');
}

describe('Day-26 fallback-rate alerting (§3.5)', () => {
  it('defines an alert rule for every degradation counter', () => {
    const alerts = alertsFile();

    for (const { metric, counter } of DEGRADATION_METRICS) {
      // The alert expr must reference the exact Prometheus metric name.
      expect(alerts, `missing alert for ${counter}`).toContain(metric);
    }
  });

  it('is a well-formed Prometheus rules group (alert + expr + severity)', () => {
    const alerts = alertsFile();
    expect(alerts).toContain('groups:');
    expect(alerts).toContain('- alert: ');
    expect(alerts).toContain('expr: rate(');
    expect(alerts).toContain('severity: page');
  });

  it('is imported by the scrape config via rule_files', () => {
    const prometheus = readFileSync(PROMETHEUS, 'utf8');
    expect(prometheus).toContain('rule_files:');
    expect(prometheus).toContain('alerts.yml');
  });

  it('resolves the repo root (guarding against a moved file)', () => {
    // If this directory ever moves, the relative paths above break loudly here
    // rather than silently reading the wrong (or no) file.
    expect(ROOT).toContain('harness-human-attention-infrastructure');
  });
});
