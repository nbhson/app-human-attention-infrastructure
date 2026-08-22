/**
 * Offline metric computation model (day-06 §2.2).
 *
 * `MetricsComputer` is a **pure** function of these row types — no `Date.now()`,
 * no env, no DB access inside the compute path. The caller (`loader.ts`) runs the
 * windowed queries against the append-only store, strips them down to these
 * plain rows, and hands the result in. That is what makes a given window's
 * numbers byte-for-byte reproducible in CI and in the A/B harness (Day 09).
 *
 * Every report carries its `[from, to]` window — an unwindowed aggregate is
 * meaningless (day-06 §6).
 */

/** One human review decision, joined to its assessment (for label + dwell). */
export interface DecisionRow {
  readonly decisionId: string;
  /** The assessment this decision is about — the join key to a route. */
  readonly assessmentId: string;
  readonly changeId: string;
  /** A {@link HumanDecisionType} value (`APPROVED`, `REJECTED`, …). */
  readonly decision: string;
  readonly createdAt: Date;
  /** Claim → decide latency in seconds; `undefined` when the claim time is unknown. */
  readonly dwellSeconds?: number;
  /** The assessment's priority label (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`). */
  readonly label?: string;
}

/** A task re-entering a "needs attention later" state (a downstream defect). */
export interface ReworkRow {
  readonly taskId: string;
  /** The `to_state` of the transition, e.g. `REWORK` / `AWAITING_HUMAN_INTERVENTION`. */
  readonly toState: string;
  readonly occurredAt: Date;
}

/** One `attention.item_routed` event — a single routing decision. */
export interface RouteRow {
  readonly queueId: string;
  readonly assessmentId: string;
  readonly taskId: string;
  /** A {@link RoutingAction} value; anything except `AUTO_APPROVABLE` is "human". */
  readonly action: string;
  readonly occurredAt: Date;
  /** The assessment's priority label, from the join (used for inflation). */
  readonly label?: string;
}

/**
 * One shadow rank-comparison record (day-18 §2.4), windowed for the report. The
 * served `rank_method` is always `keyword`; this is the *shadow* semantic order's
 * agreement with it, held against the per-request opt-in (`semanticShadowEnabled`).
 */
export interface ShadowRow {
  readonly comparisonId: string;
  /** Kendall tau over the overlapping top-k; `null` when <2 items were shared. */
  readonly rankCorrelation: number | null;
}

/**
 * A point-in-time read of the continuous infra counters (day-25 §3.2). The
 * structural twin of `@harness/observability`'s `InfraCountersSnapshot`, so the
 * snapshot drops straight into `compute`. Counts are cumulative over process
 * lifetime, not per-window — the caller decides which window to attribute them to.
 */
export interface InfraCounters {
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly sandboxRuns: number;
  readonly sandboxFallbacks: number;
  readonly sandboxDurationMs: number;
  readonly objectIntegrityErrors: number;
}

/** The windowed, read-only inputs {@link MetricsComputer.compute} consumes. */
export interface MetricsInput {
  readonly from: Date;
  readonly to: Date;
  readonly decisionLog: readonly DecisionRow[];
  readonly reworkLog: readonly ReworkRow[];
  readonly routeLog: readonly RouteRow[];
  /** Shadow rank-correlation rows, present only when the semantic shadow ran. */
  readonly shadowLog?: readonly ShadowRow[];
  /** Continuous infra counters, present only when a live process supplies them. */
  readonly infraCounters?: InfraCounters;
}

/** Spec 11 §4.1 routing-quality metrics. Each is `undefined` (not `NaN`) when its denominator is empty. */
export interface RoutingMetrics {
  /** Warranted-and-routed-to-human / routed-to-human. */
  readonly precision?: number;
  /** Warranted-and-routed / all-warranted (routed + fly-through-that-defected). */
  readonly recall?: number;
  /** Fly-through-then-defected / fly-through. */
  readonly escalationLeakage?: number;
}

/** Spec 11 §4.2 attention-efficiency metrics (measured, never guessed). */
export interface EfficiencyMetrics {
  /** Mean review dwell over accepted decisions, in minutes. Omitted when any accepted item lacks dwelling. */
  readonly humanMinutesPerAccept?: number;
  /** Share of the window's assessments labeled `CRITICAL` or `HIGH`. */
  readonly inflationRatio?: number;
}

/**
 * Day-25 shadow signal (§3.2): how well the *shadow* semantic ordering agreed
 * with the served keyword ordering over the window. `meanRankCorrelation` is
 * omitted when no comparison had a computable tau (fewer than 2 shared items).
 */
export interface ShadowMetrics {
  /** Number of shadow rank comparisons written in the window. */
  readonly comparisons: number;
  /** Mean Kendall tau over the window's comparisons, `undefined` when none computable. */
  readonly meanRankCorrelation?: number;
}

/**
 * Day-25 continuous-infra signal (§3.2): cache, sandbox, and object-store
 * liveness, derived from a cumulative counter snapshot. Every ratio is `undefined`
 * (an honest hole) when its denominator is zero — no false `0` for "no traffic".
 */
export interface InfraMetrics {
  /** `cacheHits / (cacheHits + cacheMisses)`. */
  readonly cacheHitRatio?: number;
  /** `sandboxFallbacks / (sandboxRuns + sandboxFallbacks)` — the isolation liveness signal. */
  readonly sandboxFallbackRate?: number;
  /** Mean sandbox run latency in ms (`sandboxDurationMs / sandboxRuns`). */
  readonly sandboxAvgDurationMs?: number;
  /** Non-zero object-store integrity errors only (absence means "no drift"). */
  readonly objectIntegrityErrors?: number;
}

/** The full report shape, consumed by the Day-07 report generator. */
export interface MetricsReport {
  readonly window: { readonly from: string; readonly to: string };
  readonly routing: RoutingMetrics;
  readonly efficiency: EfficiencyMetrics;
  /** Week-5 shadow signal (day-25 §3.2); absent on a bare Phase-1 report. */
  readonly shadow?: ShadowMetrics;
  /** Week-5 infra signal (day-25 §3.2); absent when no live snapshot was supplied. */
  readonly infra?: InfraMetrics;
  /** The served ranking method — the invariant made *visible* (always `keyword`). */
  readonly rankMethod?: 'keyword';
}

/**
 * One flattened metric line in a generated report (day-07 §2.1): the current
 * window value, its prior-window baseline, the delta, a direction, and — when a
 * threshold is crossed — a human-readable guardrail note.
 */
export interface MetricLine {
  /** Dotted metric key, e.g. `"routing.precision"`. */
  readonly key: string;
  /** Current-window value; `undefined` is the honest hole (no NaN/0 padding). */
  readonly value: number | undefined;
  /** Prior-window value; `undefined` when there is no baseline to compare. */
  readonly previousValue: number | undefined;
  /** `value - previousValue`; `undefined` when either side is missing. */
  readonly delta: number | undefined;
  /** Delta-derived direction — never model-derived (day-07 §2.1). */
  readonly trend: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';
  /** Human string emitted when a threshold is crossed (never an auto-action). */
  readonly guardrail?: string;
}

/**
 * The flat, human-readable report a generated window produces (day-07 §2.1).
 * `lines` is the stable 5-metric flattening of a {@link MetricsReport}; `window`
 * and `generatedAt` make every report self-describing and trend-attributable.
 */
export interface EvaluationReport {
  readonly window: { readonly from: string; readonly to: string };
  readonly generatedAt: string;
  readonly lines: readonly MetricLine[];
  /** Week-5 shadow signal — always rendered (empty `{ comparisons: 0 }` when absent). */
  readonly shadow: ShadowMetrics;
  /** Week-5 infra signal — always rendered (empty `{}` when no snapshot). */
  readonly infra: InfraMetrics;
  /** The served ranking method — the invariant made *visible* (`keyword`). */
  readonly rankMethod: 'keyword';
}
