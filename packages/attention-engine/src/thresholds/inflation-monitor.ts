/**
 * The live inflation monitor (day-13 §2.1, §3.4).
 *
 * Rising CRITICAL+HIGH share is either miscalibration *or* a real risk-profile
 * change — a controller cannot tell which, so the monitor **alerts, never
 * auto-adjusts** (§2.1, §6). When the share of CRITICAL+HIGH assessments over a
 * rolling window exceeds the ceiling, it emits `attention.inflation_detected`
 * (governance note for a human) and mirrors the share onto the Day-04 gauge
 * `harness_attention_inflation_ratio`. It touches no threshold.
 */

import { gte } from 'drizzle-orm';

import { assessments } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { EventType, newCorrelationID } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { setGauge } from '@harness/observability';

/** The offline gauge the monitor mirrors the CRITICAL+HIGH share onto. */
export const INFLATION_GAUGE = 'harness_attention_inflation_ratio';

export interface InflationConfig {
  /** Rolling window (days) over which the share is computed. */
  readonly windowDays: number;
  /** The CRITICAL+HIGH share ceiling; crossing it alerts, never auto-lowers. */
  readonly ceiling: number;
}

/** CRITICAL+HIGH share of a label list. Pure. */
export function computeHighShare(labels: readonly string[]): number {
  const total = labels.length;
  if (total === 0) {
    return 0;
  }
  let highish = 0;
  for (const label of labels) {
    if (label === 'CRITICAL' || label === 'HIGH') {
      highish += 1;
    }
  }
  return highish / total;
}

/**
 * The on-demand inflation check. Returns the observed share+ceiling when it
 * crosses the bar, else `null`. Mirrors the share onto the gauge on **every**
 * run (a healthy share is a datum too), but only publishes the event on breach.
 */
export class InflationMonitor {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly config: InflationConfig,
  ) {}

  async run(): Promise<{ share: number; ceiling: number } | null> {
    const cutoff = new Date(Date.now() - this.config.windowDays * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ label: assessments.label })
      .from(assessments)
      .where(gte(assessments.created_at, cutoff));

    const share = computeHighShare(rows.map((row) => row.label));
    setGauge(INFLATION_GAUGE, share);

    if (share <= this.config.ceiling) {
      return null;
    }

    this.bus.publish(
      createEvent(EventType.AttentionInflationDetected, newCorrelationID(), {
        share,
        ceiling: this.config.ceiling,
        window_days: this.config.windowDays,
      }),
    );
    return { share, ceiling: this.config.ceiling };
  }
}
