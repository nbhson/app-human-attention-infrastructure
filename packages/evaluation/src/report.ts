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

/** The windowed, read-only inputs {@link MetricsComputer.compute} consumes. */
export interface MetricsInput {
  readonly from: Date;
  readonly to: Date;
  readonly decisionLog: readonly DecisionRow[];
  readonly reworkLog: readonly ReworkRow[];
  readonly routeLog: readonly RouteRow[];
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

/** The full report shape, consumed by the Day-07 report generator. */
export interface MetricsReport {
  readonly window: { readonly from: string; readonly to: string };
  readonly routing: RoutingMetrics;
  readonly efficiency: EfficiencyMetrics;
}
