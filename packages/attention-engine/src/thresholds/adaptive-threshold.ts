/**
 * The adaptive HIGH/CRITICAL threshold controller (day-13 §2.1, §3.2).
 *
 * Day 12 fitted the *weights*; today tunes the *decision boundary* using the
 * same closed, auditable feedback loop. Over a rolling window of decisions on a
 * single band, the controller applies the §2.1 rule one **quantized step** at a
 * time, clamped to persistent bounds:
 *
 *  - approval rate `> approveRaiseBar` → raise the cutoff (promote fewer to review);
 *  - rejection/rework rate `> rejectLowerBar` → lower the cutoff (promote more scrutiny);
 *  - a window below `minDecisions` → **no-op** (never adapt on noise).
 *
 * Each move is persisted by the {@link ThresholdStore} (append-only, `supersedes`
 * chained) and published as `attention.threshold_adjusted{before, after, reason}`.
 * The pure `decideThresholdChange` carries the whole rule with no DB, so the
 * step/bounds/no-op matrix is unit-testable in isolation.
 */

import { and, eq, gte } from 'drizzle-orm';

import { assessments, decisions } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { EventType, newCorrelationID } from '@harness/domain';
import type { ThresholdBand } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';

import type { ThresholdStore } from './threshold-store.js';

/** The `[min, max]` cutoff bounds a band's threshold is clamped to. */
export interface AdaptiveBounds {
  readonly min: number;
  readonly max: number;
}

/** Tuning parameters for one band's adaptive loop. */
export interface AdaptiveConfig {
  readonly projectId: string;
  readonly band: ThresholdBand;
  /** Rolling window (days) over which decisions are observed. */
  readonly windowDays: number;
  /** Minimum decided count below which the controller refuses to adapt. */
  readonly minDecisions: number;
  /** A single quantized step, applied at most once per run. */
  readonly step: number;
  /** Approval rate strictly above which the cutoff is raised. */
  readonly approveRaiseBar: number;
  /** Rejection/rework rate strictly above which the cutoff is lowered. */
  readonly rejectLowerBar: number;
  readonly bounds: AdaptiveBounds;
}

/** The demonstrated HIGH band range (day-13 §2.1): `[0.60, 0.80]`. */
export const HIGH_BANDS: AdaptiveBounds = { min: 0.6, max: 0.8 };
/** The demonstrated CRITICAL band range (day-13 §2.2, fixed in v0). */
export const CRITICAL_BANDS: AdaptiveBounds = { min: 0.8, max: 0.95 };

/** Defaults matching the §2.1 rule: 30-day window, ±0.02 step, N ≥ 5. */
export const DEFAULT_ADAPTIVE: Omit<AdaptiveConfig, 'projectId' | 'band'> = {
  windowDays: 30,
  minDecisions: 5,
  step: 0.02,
  approveRaiseBar: 0.95,
  rejectLowerBar: 0.3,
  bounds: HIGH_BANDS,
};

/** The observed decision mix for a band over the window. */
export interface WindowRates {
  readonly decided: number;
  readonly approvalRate: number;
  readonly rejectionRate: number;
}

/** A computed threshold move (or `null` when nothing is warranted). */
export interface ThresholdDecision {
  readonly before: number;
  readonly after: number;
  readonly reason: string;
}

const DECISION_LOWER = new Set(['REJECTED', 'REQUEST_CHANGES']);

/** Clamp to `[min, max]` and round to 2 decimals (kills float drift on ±0.02). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, bounds: AdaptiveBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/** Approval / rejection rates over a raw decision list. Pure. */
export function computeRates(decisionList: readonly string[]): WindowRates {
  const decided = decisionList.length;
  let approved = 0;
  let rejected = 0;
  for (const decision of decisionList) {
    if (decision === 'APPROVED') approved += 1;
    else if (DECISION_LOWER.has(decision)) rejected += 1;
  }
  return {
    decided,
    approvalRate: decided === 0 ? 0 : approved / decided,
    rejectionRate: decided === 0 ? 0 : rejected / decided,
  };
}

/**
 * The §2.1 rule as a pure function of `current` and the observed `rates`. A
 * raise/lower that does not move the (clamped, rounded) value is a `null` no-op,
 * so a repeat run at the bound never emits a spurious event.
 */
export function decideThresholdChange(
  current: number,
  rates: WindowRates,
  config: AdaptiveConfig,
): ThresholdDecision | null {
  const before = round2(clamp(current, config.bounds));
  if (rates.decided < config.minDecisions) {
    return null;
  }
  if (rates.approvalRate > config.approveRaiseBar) {
    const after = round2(clamp(before + config.step, config.bounds));
    if (after === before) return null;
    return {
      before,
      after,
      reason: `approval_rate ${rates.approvalRate.toFixed(2)} > ${config.approveRaiseBar}`,
    };
  }
  if (rates.rejectionRate > config.rejectLowerBar) {
    const after = round2(clamp(before - config.step, config.bounds));
    if (after === before) return null;
    return {
      before,
      after,
      reason: `rejection_rate ${rates.rejectionRate.toFixed(2)} > ${config.rejectLowerBar}`,
    };
  }
  return null;
}

/**
 * Adapts one band's cutoff from its persisted history + the live decision stream.
 * `run()` loads the latest value, applies the rule over the rolling window,
 * persists any move, and emits `attention.threshold_adjusted` — or returns `null`
 * when the window is too small / no rate crosses its bar.
 */
export class AdaptiveThresholdController {
  constructor(
    private readonly db: DrizzleDB,
    private readonly store: ThresholdStore,
    private readonly bus: IEventBus,
    private readonly config: AdaptiveConfig,
  ) {}

  async run(): Promise<ThresholdDecision | null> {
    const active = await this.store.getActive(this.config.projectId, this.config.band);
    const current = active?.cutoff ?? this.config.bounds.min;

    const cutoff = new Date(Date.now() - this.config.windowDays * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ decision: decisions.decision })
      .from(decisions)
      .innerJoin(assessments, eq(assessments.id, decisions.assessment_id))
      .where(and(eq(assessments.label, this.config.band), gte(decisions.created_at, cutoff)));

    const rates = computeRates(rows.map((row) => row.decision));
    const decision = decideThresholdChange(current, rates, this.config);
    if (decision === null) {
      return null;
    }

    await this.store.apply(this.config.projectId, {
      band: this.config.band,
      cutoff: decision.after,
      minBounds: this.config.bounds.min,
      maxBounds: this.config.bounds.max,
      reason: decision.reason,
    });

    this.bus.publish(
      createEvent(EventType.AttentionThresholdAdjusted, newCorrelationID(), {
        band: this.config.band,
        before: decision.before,
        after: decision.after,
        reason: decision.reason,
      }),
    );

    return decision;
  }
}
