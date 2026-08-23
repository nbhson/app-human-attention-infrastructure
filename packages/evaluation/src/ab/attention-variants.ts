/**
 * Attention-weight A/B variants (day-23 §3.3) — the refitted candidate weight
 * set as a {@link PipelineVariant} alongside the unchanged incumbent.
 *
 * The Day-09/29 harness already compares two *context rankers* head-to-head. Day
 * 23 reuses the same `PipelineVariant` model for the *attention weights*: the
 * incumbent and the judge-signal candidate are declared as two variants that
 * differ only in `attentionWeights` (vary one thing), so the refit is loadable as
 * a variant for a head-to-head comparison — never dropped into the live DI graph
 * (§3.3 "nothing flips today").
 *
 * Both variants keep the same `contextRanker` (`keyword`) because the attention
 * comparison varies the weighting, not the ranking. `WeightsVector` (the fitter's
 * convex combination) is structurally identical to {@link AttentionWeights}, so
 * the mapping is a field-for-field copy into the harness type.
 */

import type { WeightsVector } from '../calibration/weight-fitter.js';
import type { AttentionWeights, PipelineVariant } from '../harness/variant.js';

/** Field-for-field copy `WeightsVector` → harness `AttentionWeights`. */
export function toAttentionWeights(weights: WeightsVector): AttentionWeights {
  return {
    risk: weights.risk,
    impact: weights.impact,
    novelty: weights.novelty,
    complexity: weights.complexity,
    confidence: weights.confidence,
  };
}

/** Stable variant ids so a stored comparison can be re-emitted later. */
export const INCUMBENT_ATTENTION_VARIANT_ID = 'attention-incumbent';
export const CANDIDATE_ATTENTION_VARIANT_ID = 'attention-judge-candidate';

/** The incumbent/candidate variant pair, ready for a head-to-head comparison. */
export interface AttentionVariantPair {
  readonly incumbent: PipelineVariant;
  readonly candidate: PipelineVariant;
}

/** Build the two attention-weight variants (incumbent unchanged, candidate refit). */
export function attentionWeightVariants(
  incumbent: WeightsVector,
  candidate: WeightsVector,
): AttentionVariantPair {
  return {
    incumbent: {
      variantId: INCUMBENT_ATTENTION_VARIANT_ID,
      description:
        'incumbent attention weights — risk/impact/novelty/complexity/confidence (unrefitted)',
      contextRanker: 'keyword',
      attentionWeights: toAttentionWeights(incumbent),
    },
    candidate: {
      variantId: CANDIDATE_ATTENTION_VARIANT_ID,
      description:
        'judge-signal-refitted attention weights — confidence column carries judge disagreement',
      contextRanker: 'keyword',
      attentionWeights: toAttentionWeights(candidate),
    },
  };
}
