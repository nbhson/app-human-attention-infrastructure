/**
 * Auto-approve gate (day-14 §2.1) — the three-part AND, evaluated in order.
 *
 * Eligibility is gated so a change is auto-approved *only* when all three hold:
 *
 *  1. **Calibration is green** — a `calibration_weights` row exists whose fitted
 *     metrics beat the placeholder, *and* the inflation monitor is below the
 *     ceiling (Day 13).
 *  2. **The flag is on** — an ADMIN flipped `auto_approve_enabled` (Spec 6 §2.2).
 *  3. **The item clears the bar** — `combined_priority < max_risk` and no
 *     `ALWAYS_REVIEW` rule matches (Spec 6 §4).
 *
 * The order matters (§6): calibration-red blocks *regardless* of the flag — a
 * flipped flag with red calibration is a governance denial, never an approval.
 * The reason strings are stable so tests and logs can assert on them.
 */

/** The latest fitted `calibration_weights` evidence the gate consumes (Day 12). */
export interface CalibrationEvidence {
  /** The dataset the fit consumed (recorded on the auto-approve decision). */
  readonly datasetId: string;
  readonly logLossFitted: number;
  readonly logLossPlaceholder: number;
  readonly rankingAccuracyFitted: number;
  readonly rankingAccuracyPlaceholder: number;
}

/** The gate's static tuning, sourced from the policy. */
export interface AutoApproveGateConfig {
  /** Items clear the bar only when `combined_priority` is strictly below this. */
  readonly maxRisk: number;
  /** The inflation-ceiling share (CRITICAL+HIGH) above which calibration is red. */
  readonly inflationCeiling: number;
}

/** A structured gate verdict: either allowed, or the first part that failed. */
export type AutoApproveGateResult = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** Inputs to one gate evaluation, assembled by the executor. */
export interface AutoApproveGateInput {
  /** Latest fit, or `null` when no fit exists yet. */
  readonly calibration: CalibrationEvidence | null;
  /** CRITICAL+HIGH share mirrored by the inflation monitor (§2.1 part 1). */
  readonly inflationShare: number;
  /** The runtime feature flag (§2.1 part 2). */
  readonly flagEnabled: boolean;
  /** The assessment's combined priority (§2.1 part 3). */
  readonly combinedPriority: number;
  /** True when an `ALWAYS_REVIEW` policy path matched (§2.1 part 3). */
  readonly alwaysReview: boolean;
}

export class AutoApproveGate {
  constructor(private readonly config: AutoApproveGateConfig) {}

  evaluate(input: AutoApproveGateInput): AutoApproveGateResult {
    // 1. Calibration green (fitted-beats-placeholder + inflation below ceiling).
    if (input.calibration === null) {
      return { allowed: false, reason: 'calibration-red: no fitted weights' };
    }
    if (input.calibration.logLossFitted >= input.calibration.logLossPlaceholder) {
      return { allowed: false, reason: 'calibration-red: log-loss not improved' };
    }
    if (input.calibration.rankingAccuracyFitted < input.calibration.rankingAccuracyPlaceholder) {
      return { allowed: false, reason: 'calibration-red: ranking not improved' };
    }
    if (input.inflationShare > this.config.inflationCeiling) {
      return { allowed: false, reason: 'calibration-red: inflation above ceiling' };
    }

    // 2. The flag is on.
    if (!input.flagEnabled) {
      return { allowed: false, reason: 'flag-off' };
    }

    // 3. The item clears the bar.
    if (input.alwaysReview) {
      return { allowed: false, reason: 'always-review' };
    }
    if (input.combinedPriority >= this.config.maxRisk) {
      return { allowed: false, reason: 'over-max-risk' };
    }

    return { allowed: true };
  }
}
