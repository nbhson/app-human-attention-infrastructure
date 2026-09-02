/**
 * Day-29 §2.3 — outcome signals, computed over replayed inputs and ranked orderings.
 *
 * The four signals are pure functions of (ranked order, recorded trajectory outcome),
 * never of the live store. `rank_correlation` is reported as a **distribution** over
 * inputs, not a single scalar (§5): each input contributes one Kendall tau between the
 * keyword and hybrid orders over their intersecting top-k. The other three signals
 * follow the repo's "`undefined` is an honest hole" rule — a zero/empty denominator
 * omits the metric rather than emitting `NaN`.
 */

/** Per-input material for scoring one arm's ordering. */
export interface OutcomeInput {
  /** The arm's full ordering (sourceIds, best-first) for one replayed run. */
  readonly injectedOrder: readonly string[];
  /** Files the run actually consumed (read, wrote, or changed). */
  readonly consumedPaths: readonly string[];
  /** The injected-context size both arms truncate to. */
  readonly topK: number;
  /** Recorded wall-clock minutes of the run (absent when the fixture is unsealed). */
  readonly elapsedMinutes?: number;
}

/** The three arm-specific outcome signals of §2.3 (each optional = honest hole). */
export interface OutcomeSignals {
  /** Precision: share of the injected top-k the run actually consumed. */
  readonly contextAcceptanceRate?: number;
  /** Dry-run dwell proxy: recorded minutes scaled by the rework miss ratio. */
  readonly humanMinutesPerAccept?: number;
  /** Recall-miss: share of inputs whose consumed files missed the top-k. */
  readonly reworkRate?: number;
}

/** Kendall tau over the intersection of two orderings; `null` when <2 are shared. */
export function kendallTau(a: readonly string[], b: readonly string[]): number | null {
  const inB = new Set(b);
  const common = a.filter((id) => inB.has(id));
  if (common.length < 2) return null;

  const rankInB = new Map(b.map((id, index) => [id, index]));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < common.length; i += 1) {
    for (let j = i + 1; j < common.length; j += 1) {
      const bi = rankInB.get(common[i] as string) ?? 0;
      const bj = rankInB.get(common[j] as string) ?? 0;
      if (bi < bj) concordant += 1;
      else if (bi > bj) discordant += 1;
    }
  }
  const pairs = (common.length * (common.length - 1)) / 2;
  return (concordant - discordant) / pairs;
}

/** Pairwise rank_correlation across inputs, as a distribution (day-29 §5). */
export interface RankCorrelationDistribution {
  /** One Kendall tau per input (keyword vs hybrid over the shared top-k). */
  readonly values: readonly number[];
  /** Number of inputs that produced a computable tau (≥2 shared top-k items). */
  readonly count: number;
  readonly mean?: number;
  readonly min?: number;
  readonly max?: number;
}

/** Correlate two arms' per-input orderings over their intersecting top-k. */
export function rankCorrelationDistribution(
  aOrders: readonly (readonly string[])[],
  bOrders: readonly (readonly string[])[],
  topK: number,
): RankCorrelationDistribution {
  const values: number[] = [];
  const length = Math.min(aOrders.length, bOrders.length);
  for (let i = 0; i < length; i += 1) {
    const tau = kendallTau((aOrders[i] ?? []).slice(0, topK), (bOrders[i] ?? []).slice(0, topK));
    if (tau !== null) values.push(tau);
  }
  const min = values.length > 0 ? Math.min(...values) : undefined;
  const max = values.length > 0 ? Math.max(...values) : undefined;
  const mean = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
  return {
    values,
    count: values.length,
    ...(mean !== undefined ? { mean } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
}

function injectedSet(input: OutcomeInput): Set<string> {
  return new Set(input.injectedOrder.slice(0, input.topK));
}

/** Precision: |consumed ∩ injected top-k| / |injected top-k|. */
function acceptanceFor(input: OutcomeInput): number {
  const injected = input.injectedOrder.slice(0, input.topK);
  if (injected.length === 0) return 0;
  const present = new Set(injected);
  let hits = 0;
  for (const path of input.consumedPaths) {
    if (present.has(path)) hits += 1;
  }
  return hits / injected.length;
}

/** Recall-miss: 1 when a consumed file missed the top-k (a re-route/rework), else 0. */
function reworkFor(input: OutcomeInput): number {
  if (input.consumedPaths.length === 0) return 0;
  const present = injectedSet(input);
  return input.consumedPaths.some((path) => !present.has(path)) ? 1 : 0;
}

/** Dry-run dwell proxy: baseline minutes inflated by the share of files the arm missed. */
function minutesFor(input: OutcomeInput): number {
  const present = injectedSet(input);
  const missingCount = input.consumedPaths.filter((path) => !present.has(path)).length;
  const baseline = input.elapsedMinutes ?? 0;
  return baseline * (1 + missingCount / Math.max(1, input.consumedPaths.length));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Aggregate the three arm-specific signals over a set of replayed inputs. */
export function aggregateSignals(inputs: readonly OutcomeInput[]): OutcomeSignals {
  if (inputs.length === 0) return {};
  const dwellInputs = inputs.filter((input) => input.elapsedMinutes !== undefined);
  return {
    contextAcceptanceRate: mean(inputs.map(acceptanceFor)),
    reworkRate: mean(inputs.map(reworkFor)),
    ...(dwellInputs.length > 0 ? { humanMinutesPerAccept: mean(dwellInputs.map(minutesFor)) } : {}),
  };
}

/** The §2.4 minimum-evidence bar, declared *before* the run (day-29 §2.4). */
export interface EvidenceBar {
  /** Minimum tasks completed end-to-end for a meaningful comparison. */
  readonly minTasks: number;
  /** A per-input tau below this counts the arms as "disagreeing" on that task. */
  readonly correlationDisagreementThreshold: number;
  /** Minimum share of inputs that must disagree for the comparison to matter. */
  readonly minDisagreeingShare: number;
}

export const DEFAULT_EVIDENCE_BAR: EvidenceBar = {
  minTasks: 3,
  correlationDisagreementThreshold: 0.9,
  minDisagreeingShare: 0.5,
};

export interface EvidenceVerdict {
  readonly verdict: 'sufficient' | 'insufficient';
  /** The specific bars that failed (empty when sufficient). */
  readonly reasons: readonly string[];
}

/** True when a signal set has no computed value, or every computed value is zero. */
function allDegenerate(signals: OutcomeSignals): boolean {
  const values = [signals.contextAcceptanceRate, signals.humanMinutesPerAccept, signals.reworkRate].filter(
    (value): value is number => value !== undefined,
  );
  return values.length === 0 || values.every((value) => value === 0);
}

/** Apply the §2.4 bar: N, top-k disagreement, and signal non-degeneracy. */
export function evaluateEvidence(
  bar: EvidenceBar,
  numInputs: number,
  correlation: RankCorrelationDistribution,
  signalsA: OutcomeSignals,
  signalsB: OutcomeSignals,
): EvidenceVerdict {
  const reasons: string[] = [];

  if (numInputs < bar.minTasks) {
    reasons.push(`N=${numInputs} below the minimum ${bar.minTasks} completed tasks`);
  }

  if (correlation.count === 0) {
    reasons.push('no computable rank_correlation (top-k intersection < 2 on every input)');
  } else {
    const disagreeing = correlation.values.filter((value) => value < bar.correlationDisagreementThreshold).length;
    const disagreeingShare = disagreeing / correlation.count;
    if (disagreeingShare < bar.minDisagreeingShare) {
      reasons.push(
        `rank_correlation disagreement ${Math.round(disagreeingShare * 100)}% below the ` +
          `${Math.round(bar.minDisagreeingShare * 100)}% bar`,
      );
    }
  }

  if (allDegenerate(signalsA) || allDegenerate(signalsB)) {
    reasons.push('outcome signals are degenerate (all zero or missing)');
  }

  return { verdict: reasons.length === 0 ? 'sufficient' : 'insufficient', reasons };
}

/** The Day-30 call: promote / keep-shadow / real-A/B (§5). */
export type Recommendation = 'promote' | 'keep-shadow' | 'real-ab';

/**
 * Decide the recommendation from the verdict and the two arms' outcome signals.
 * Outcome signals — not ranking proxies — are the basis (§2.3, §6): a toss-up or a
 * null result is answered honestly, never dressed up as a win.
 */
export function recommend(
  verdict: EvidenceVerdict,
  signalsA: OutcomeSignals,
  signalsB: OutcomeSignals,
): Recommendation {
  if (verdict.verdict === 'insufficient') return 'keep-shadow';

  const aRework = signalsA.reworkRate ?? Infinity;
  const bRework = signalsB.reworkRate ?? Infinity;
  const aAcceptance = signalsA.contextAcceptanceRate ?? 0;
  const bAcceptance = signalsB.contextAcceptanceRate ?? 0;

  // B lowers rework without trading away context acceptance → Phase-3 default.
  if (bRework < aRework && bAcceptance >= aAcceptance) return 'promote';
  // B is strictly worse → the challenger has no measured value yet.
  if (bRework > aRework && bAcceptance <= aAcceptance) return 'keep-shadow';
  // A true toss-up (different ranking, comparable outcome) → resolve with a live A/B.
  return 'real-ab';
}
