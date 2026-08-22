/**
 * Meter provider bootstrap (day-03 §3.1; filled by day-04).
 *
 * Day 03 ships the provider wiring and a no-op `getMeter`; Day 04 adds the
 * metrics themselves (routing precision/recall, review dwell, usefulness
 * counters). Keeping the provider here means Day 04 has a single place to hang
 * a `MeterProvider` + `PrometheusExporter` without touching engines again.
 */

import { metrics } from '@opentelemetry/api';
import type { Meter } from '@opentelemetry/api';

let meterName = 'harness';

/** The `Meter` used to define harness metrics. A no-op until Day 04 registers it. */
export function getMeter(): Meter {
  return metrics.getMeter(meterName);
}

/** Override the meter name (tests, or a Day-04 composition root). */
export function setMeterName(name: string): void {
  meterName = name;
}
