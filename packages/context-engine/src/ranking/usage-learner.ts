/**
 * Usage learner (day-32 §3.2) — turn per-source usefulness marks into a ranking
 * signal.
 *
 * The Day-27 re-ranker's `usage` term is raw popularity (`retrievalCount`): how
 * *often* a source was surfaced, blind to whether surfacing it *helped*. Day 32
 * replaces that with a **learned** signal: when a human marks a review useful (or
 * useless), the sources that were served with it earn a bounded, time-decayed nudge
 * — useful bumps a source above the neutral 0.5, useless drops it below. The map a
 * {@link UsageLearner.learn} call returns is a drop-in for `retrievalCount` on the
 * re-ranker's `learnedUsage` slot, so "proven-useful ranks higher, useless lower"
 * is one composition, not a formula change.
 *
 * Three invariants keep this a *signal, never a certainty* (day-32 §2.3):
 *
 * - **Per-mark cap** — no single mark can move a source more than
 *   {@link UsageLearnerConfig.maxSingleMark}, so one enthusiast cannot rewire the
 *   ranking.
 * - **Time decay** — a mark's influence halves every {@link UsageLearnerConfig.halfLifeMs};
 *   old feedback fades instead of ossifying the order.
 * - **Bounds** — the accumulated signal lives in `[minSignal, maxSignal]`, never 0
 *   or 1, so a source can still be pulled back by fresh evidence.
 *
 * Every source with *no* observation is absent from the result; the re-ranker maps
 * absence to neutral 0.5 — the same missing-signal fallback as day-27 §2.4.
 */

/** One usefulness observation attached to a served source. */
export interface SourceUsefulness {
  readonly sourceId: string;
  readonly useful: boolean;
  /** Epoch ms when the mark was recorded — the decay clock input. */
  readonly observedAtMs: number;
}

/** Bounds + decay for the learned signal (day-32 §2.3). */
export interface UsageLearnerConfig {
  /** The neutral signal a no-history source ranks at in the re-ranker. */
  readonly neutral: number;
  /** Max movement (absolute) a single mark may contribute. */
  readonly maxSingleMark: number;
  /** Feedback influence halves after this many ms. */
  readonly halfLifeMs: number;
  /** Floor of the accumulated signal (bounded low). */
  readonly minSignal: number;
  /** Ceiling of the accumulated signal (bounded high). */
  readonly maxSignal: number;
}

export const DEFAULT_USAGE_LEARN_CONFIG: UsageLearnerConfig = {
  neutral: 0.5,
  maxSingleMark: 0.2,
  halfLifeMs: 14 * 24 * 60 * 60 * 1000, // 14 days
  minSignal: 0.05,
  maxSignal: 0.95,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Accumulate usefulness marks into a per-source `[minSignal, maxSignal]` signal,
 * starting from neutral. Pure over its inputs; the only wall-clock is the injected
 * `now` seam (defaults to `Date.now`), so tests pin time.
 */
export class UsageLearner {
  constructor(
    private readonly config: UsageLearnerConfig = DEFAULT_USAGE_LEARN_CONFIG,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** One learned `[0,1]` usage signal per observed source; unobserved → absent. */
  learn(observations: readonly SourceUsefulness[]): ReadonlyMap<string, number> {
    const nowMs = this.now();
    const accumulated = new Map<string, number>();

    for (const observation of observations) {
      const ageMs = nowMs - observation.observedAtMs;
      const decay = clamp(Math.pow(2, -ageMs / this.config.halfLifeMs), 0, 1);
      const contribution = (observation.useful ? 1 : -1) * this.config.maxSingleMark * decay;
      accumulated.set(observation.sourceId, (accumulated.get(observation.sourceId) ?? 0) + contribution);
    }

    const signal = new Map<string, number>();
    for (const [sourceId, total] of accumulated) {
      signal.set(sourceId, clamp(this.config.neutral + total, this.config.minSignal, this.config.maxSignal));
    }
    return signal;
  }
}
