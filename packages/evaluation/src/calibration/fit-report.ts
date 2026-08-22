/**
 * Fit report assembly (day-12 §2.4, §3.3).
 *
 * Turns a {@link FitResult} (from `weight-fitter.ts`) into the persisted /
 * printed `FitReport`, including the governance note that carries the §6
 * guardrail: a fit that does not beat the placeholder is written down, not
 * silently promoted. The report is a plain JSON-serialisable object so the CLI
 * can print it verbatim and the writer can persist the measured numbers.
 */

import type { FitConfig, FitResult, WeightsVector } from './weight-fitter.js';

/** The fit method string persisted to `calibration_weights.method` (stable). */
export const FIT_METHOD = 'logistic-regression-v0/softmax';

/** Guardrail text for a non-result (day-12 §2.4/§6). */
export const NON_RESULT_NOTE =
  'fitted weights did not beat the Phase-1 placeholder on held-out validation; the placeholder stays active';

/** The human-readable artifact produced by (and persisted after) a fit. */
export interface FitReport {
  readonly datasetId: string;
  readonly labelSource: string;
  readonly method: string;
  readonly seed: number;
  readonly validationShare: number;
  readonly trainCount: number;
  readonly validationCount: number;
  readonly fittedWeights: WeightsVector;
  readonly bias: number;
  readonly placeholder: {
    readonly weights: WeightsVector;
    readonly logLoss: number;
    readonly rankingAccuracy: number;
  };
  readonly fitted: {
    readonly logLoss: number;
    readonly rankingAccuracy: number;
  };
  readonly improvement: boolean;
  readonly governanceNote: string | null;
}

/**
 * Assemble a report from a fit. The governance note is set iff the fit failed
 * to beat the placeholder, so the operator can see at a glance whether this
 * weight vector earned promotion (it is *not* promoted automatically).
 */
export function buildFitReport(
  dataset: { id: string; labelSource: string },
  result: FitResult,
  config: FitConfig,
): FitReport {
  return {
    datasetId: dataset.id,
    labelSource: dataset.labelSource,
    method: FIT_METHOD,
    seed: config.seed,
    validationShare: config.validationShare,
    trainCount: result.split.train.length,
    validationCount: result.split.validation.length,
    fittedWeights: result.fittedWeights,
    bias: result.bias,
    placeholder: result.placeholder,
    fitted: result.fitted,
    improvement: result.improvement,
    governanceNote: result.improvement ? null : NON_RESULT_NOTE,
  };
}
