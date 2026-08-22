/**
 * `WeightsProvider` seam (day-12 §2.3, §3.1, §3.5).
 *
 * The Attention Engine's combined-priority formula is *linear in the five
 * weights*, so the weight vector is the one parameter worth isolating behind a
 * seam. Day 12 fits a data-derived vector (see `@harness/evaluation`) but does
 * **not** flip it live; today the provider returns the Phase-1 placeholder, so
 * the engine's behaviour is byte-for-byte unchanged (day-12 §6: shadow-then-
 * default — fit and measure first, promote only after Day 13/14 gate it).
 *
 * The seam is deliberately a promise-returning interface: a future active-
 * weights row (or an env overridden vector) will be read asynchronously without
 * disturbing the synchronous scoring math in `scoring.ts`.
 */

import { PRIORITY_WEIGHTS } from '../types.js';
import type { AttentionWeights } from '../types.js';

/** Resolves the currently-active attention weight vector. */
export interface WeightsProvider {
  getActiveWeights(): Promise<AttentionWeights>;
}

/**
 * The default provider: returns a fixed vector (the Phase-1 placeholder) every
 * time. Constructed with no argument in DI; the optional `weights` override is
 * for tests that want to exercise `computePriority` with a fitted vector without
 * standing up a DB-backed provider.
 */
export class StaticWeightsAdapter implements WeightsProvider {
  constructor(private readonly weights: AttentionWeights = PRIORITY_WEIGHTS) {}

  async getActiveWeights(): Promise<AttentionWeights> {
    return this.weights;
  }
}
