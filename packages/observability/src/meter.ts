/**
 * Meter accessor (day-03 §3.1).
 *
 * Day 04's metrics live in `metrics.ts` on a prom-client registry (day-04 §2),
 * not on an OTel Meter. `getMeter` is retained as the OTel-meter accessor for
 * any code that wants the OTel metrics API; before a provider is registered it
 * returns the no-op meter.
 */

import { metrics } from '@opentelemetry/api';
import type { Meter } from '@opentelemetry/api';

let meterName = 'harness';

/** The `Meter` used to define harness metrics. A no-op until a provider is set. */
export function getMeter(): Meter {
  return metrics.getMeter(meterName);
}

/** Override the meter name (tests, or a composition root). */
export function setMeterName(name: string): void {
  meterName = name;
}
