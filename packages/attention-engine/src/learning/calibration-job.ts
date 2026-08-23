/**
 * Calibration job (day-31 §3.2, §3.4) — the Evaluate → Calibrate → (measured)
 * Deploy loop, reduced to one `run()`.
 *
 * ```
 * collect (CollectSeam)   →   window (collector)   →   fit (FitSeam)   →   gate
 *   new facts                  selectNewSince            candidate          PROMOTE/HOLD
 * ```
 *
 * The job owns **orchestration + provenance**, nothing more. It does not know how
 * to read the database (the {@link CollectSeam} does), how to fit weights (the
 * {@link FitSeam} does — the app binds evaluation's `fitJudgeWeights`), or how to
 * apply a weight vector (no seam; applying is a caller step). Every run returns a
 * {@link LearningRun} whose `window.reviewIds` + `fitConfig` + `candidate` +
 * `promotion` answer "what data produced what candidate, and did it clear the
 * gate?" — months later, without touching the source.
 *
 * Windowed, not per-decision (day-31 §2.4): the caller passes a `since` cursor;
 * only facts at-or-after it are fit, and an empty window is an honest no-op —
 * never a fit over zero rows (which the fitter would reject).
 */

import type { AttentionWeights } from '../types.js';

import { buildLearningWindow, selectNewSince } from './collector.js';
import { decidePromotion } from './promotion-gate.js';
import type {
  CollectSeam,
  FitSeam,
  LearningCandidate,
  LearningFitConfig,
  LearningRun,
  PromotionDecision,
} from './types.js';

/** The default solver/split config, mirroring the Phase-2 fit CLI defaults. */
export const DEFAULT_LEARNING_FIT_CONFIG: LearningFitConfig = {
  seed: 42,
  validationShare: 0.2,
  iterations: 5000,
  learningRate: 0.1,
  regularization: 0.01,
};

/** Decides PROMOTE/HOLD (inverted for a deterministic, injectable test seam). */
type PromotionSeam = (candidate: LearningCandidate) => PromotionDecision;

/** A wall-clock seam, so provenance stamps stay deterministic under test. */
type Clock = () => Date;

/**
 * The learning loop. Construct it with a collect seam and a fit seam; both are
 * injected because `attention-engine` may not import `evaluation` (where the real
 * fitter lives) — the app host adapts them across the boundary (boundary R4/R5).
 */
export class CalibrationJob {
  constructor(
    private readonly collect: CollectSeam,
    private readonly fit: FitSeam,
    private readonly incumbent: AttentionWeights,
    private readonly fitConfig: LearningFitConfig = DEFAULT_LEARNING_FIT_CONFIG,
    private readonly gate: PromotionSeam = decidePromotion,
    private readonly now: Clock = () => new Date(),
  ) {}

  /**
   * Run one tick of the loop and return its auditable result. Never throws on an
   * empty window: that is a `candidate: null` run, not an error.
   */
  async run(since: Date | null = null): Promise<LearningRun> {
    const facts = await this.collect.collect();
    const fresh = selectNewSince(facts, since);
    const { reviewIds, samples } = buildLearningWindow(fresh);

    if (samples.length === 0) {
      return {
        window: { reviewIds: [], since, collectedAt: this.now() },
        fitConfig: this.fitConfig,
        candidate: null,
        promotion: null,
        promoted: false,
      };
    }

    const candidate = this.fit.fit(samples, this.fitConfig, this.incumbent);
    const promotion = this.gate(candidate);
    return {
      window: { reviewIds, since, collectedAt: this.now() },
      fitConfig: this.fitConfig,
      candidate,
      promotion,
      promoted: promotion.outcome === 'PROMOTE',
    };
  }
}
