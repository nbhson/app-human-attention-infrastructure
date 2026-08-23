/**
 * Re-rank signals (day-27 §2.2, §2.4) — the three context-aware addends applied
 * after RRF fusion: dependency proximity, recency, and usage.
 *
 * The final relevance blends a *normalized* RRF score with these three, each in
 * `[0,1]`:
 *
 * `final = w_fusion·rrf_norm + w_dep·dependency + w_rec·recency + w_use·usage`
 *
 * Weights are placeholders until Day 32 fits them to usefulness (day-27 §6 — do
 * not hand-tune these into "looks right"). The one invariant fixed here is the
 * **neutral fallback** (§2.4): a source whose signal is *absent* (no dependency
 * graph entry, no mtime, no retrieval counter) ranks at `0.5`, never `0`, so a
 * missing signal demotes no candidate below the RRF score that already found it.
 */

/** Dependency proximity consumed via this seam — no `@harness/code-index` import. */
export type DependencyProximityResolver = (
  changedFiles: readonly string[],
  candidate: string,
) => number | null;

/** A "missing signal" value — half the `[0,1]` range, demoting nothing. */
export const NEUTRAL_SIGNAL = 0.5;

/** Recency decay: a file touched this long ago contributes `1/e`. */
export const RECENCY_HALFLIFE_MS = 30 * 24 * 60 * 60 * 1000;

/** Retrieval count at which the usage term saturates at 1. */
export const USAGE_SATURATION = 10;

/** The additive re-rank weights (sum to 1); fitted on Day 32. */
export interface ReRankWeights {
  readonly fusion: number;
  readonly dependency: number;
  readonly recency: number;
  readonly usage: number;
}

export const PLACEHOLDER_RE_RANK_WEIGHTS: ReRankWeights = {
  fusion: 0.5,
  dependency: 0.3,
  recency: 0.1,
  usage: 0.1,
};

/**
 * Dependency proximity from the resolver seam, with the §2.4 neutral fallback:
 * no resolver → neutral; resolver returning `null` (cold graph) → neutral.
 */
export function dependencySignal(
  resolver: DependencyProximityResolver | undefined,
  changedFiles: readonly string[],
  candidate: string,
): number {
  if (!resolver) return NEUTRAL_SIGNAL;
  const value = resolver(changedFiles, candidate);
  return value === null ? NEUTRAL_SIGNAL : value;
}

/** Recency as exponential decay on file age; absent mtime → neutral. */
export function recencySignal(mtimeMs: number | undefined, nowMs: number): number {
  if (mtimeMs === undefined) return NEUTRAL_SIGNAL;
  const ageMs = Math.max(0, nowMs - mtimeMs);
  return Math.exp(-ageMs / RECENCY_HALFLIFE_MS);
}

/** Usage as a linear popularity term; absent counter → neutral (0 → 0). */
export function usageSignal(retrievalCount: number | undefined): number {
  if (retrievalCount === undefined) return NEUTRAL_SIGNAL;
  return Math.min(retrievalCount / USAGE_SATURATION, 1);
}
