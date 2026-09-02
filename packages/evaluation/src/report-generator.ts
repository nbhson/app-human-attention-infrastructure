/**
 * Report assembly: current numbers, deltas vs the prior window, trend direction,
 * and threshold guardrails (day-07 §2.1–2.2, §3.1).
 *
 * `ReportGenerator.generate(current, previous?)` flattens a Day-06
 * {@link MetricsReport} into a stable five-line {@link EvaluationReport}. The
 * trend is **delta-derived, never model-derived**: `value` vs `previousValue`
 * over a fixed window length. A "trend" that needs a stat library is a Phase-3
 * nicety; a delta vs the prior period is enough to gate a rollback.
 *
 * Two honesty rules carried forward from Day 06:
 *  - An empty window throws {@link EmptyWindowError} — a report is an evidence
 *    product, and no report is better than a hollow one.
 *  - `undefined` is an honest hole: a missing baseline yields `delta: undefined`
 *    and `trend: 'UNKNOWN'`, never a padded zero.
 */

import type { EvaluationReport, MetricLine, MetricsReport } from './report.js';

/** The stable five-metric flattening, in report order (day-07 §2.2). */
const METRIC_KEYS = [
  'routing.precision',
  'routing.recall',
  'routing.escalationLeakage',
  'efficiency.humanMinutesPerAccept',
  'efficiency.inflationRatio',
] as const;

type MetricKey = (typeof METRIC_KEYS)[number];

/** Guardrail thresholds (day-07 §2.2). Kept as named constants, not inline — Day 13 tunes these. */
const PRECISION_FLOOR = 0.7;
const RECALL_FLOOR = 0.6;
const INFLATION_CEILING = 0.3;
/** `humanMinutesPerAccept` guardrail: value above 150% of the prior window. */
const HUMAN_COST_SURGE = 1.5;

/** A value is "flat" when it is unchanged within float noise. */
const FLAT_EPSILON = 1e-9;

/** Thrown when {@link generate} is asked to report on an empty/windowless input. */
export class EmptyWindowError extends Error {
  constructor() {
    super('Refusing to generate a report for an empty or windowless input — every metric is undefined');
    this.name = 'EmptyWindowError';
  }
}

/** Read the current-window value for a dotted metric key. */
function valueForKey(report: MetricsReport, key: MetricKey): number | undefined {
  switch (key) {
    case 'routing.precision':
      return report.routing.precision;
    case 'routing.recall':
      return report.routing.recall;
    case 'routing.escalationLeakage':
      return report.routing.escalationLeakage;
    case 'efficiency.humanMinutesPerAccept':
      return report.efficiency.humanMinutesPerAccept;
    case 'efficiency.inflationRatio':
      return report.efficiency.inflationRatio;
  }
}

const GUARDRAIL_PRECISION = 'Precision below 0.70 — review the routing thresholds';
const GUARDRAIL_RECALL = 'Recall below 0.60 — auto-approvable set is leaking defects';
const GUARDRAIL_INFLATION = 'Inflation alert — Spec 6 §4.1 ceiling crossed';
const GUARDRAIL_HUMAN_COST = 'Human cost per accept rising sharply';

/**
 * Emit the human guardrail string for a metric when its threshold is crossed.
 * Thresholds are alerts for humans, never auto-actions (day-07 §6).
 */
function guardrailFor(
  key: MetricKey,
  value: number | undefined,
  previousValue: number | undefined,
): string | undefined {
  switch (key) {
    case 'routing.precision':
      return value !== undefined && value < PRECISION_FLOOR ? GUARDRAIL_PRECISION : undefined;
    case 'routing.recall':
      return value !== undefined && value < RECALL_FLOOR ? GUARDRAIL_RECALL : undefined;
    case 'efficiency.inflationRatio':
      return value !== undefined && value > INFLATION_CEILING ? GUARDRAIL_INFLATION : undefined;
    case 'efficiency.humanMinutesPerAccept':
      return value !== undefined && previousValue !== undefined && value > previousValue * HUMAN_COST_SURGE
        ? GUARDRAIL_HUMAN_COST
        : undefined;
    default:
      return undefined;
  }
}

/** Delta-derived trend: `UNKNOWN` without a baseline, `FLAT` within float noise. */
function trendFor(value: number | undefined, previousValue: number | undefined): MetricLine['trend'] {
  if (value === undefined || previousValue === undefined) {
    return 'UNKNOWN';
  }
  const delta = value - previousValue;
  if (Math.abs(delta) < FLAT_EPSILON) {
    return 'FLAT';
  }
  return delta > 0 ? 'UP' : 'DOWN';
}

/** The report assembly seam (day-07 §1.1). */
export class ReportGenerator {
  /**
   * Flatten `current` into an {@link EvaluationReport}, comparing each metric to
   * the prior window's lines (`previous`). `previous` defaults to "no baseline",
   * which yields `delta`/`trend` holes (`undefined`/`UNKNOWN`) rather than a
   * fabricated zero-comparison.
   */
  generate(current: MetricsReport, previous?: readonly MetricLine[], generatedAt: Date = new Date()): EvaluationReport {
    if (current.window.from === '' || current.window.to === '') {
      throw new EmptyWindowError();
    }

    const previousValues = new Map<string, number>();
    for (const line of previous ?? []) {
      if (line.value !== undefined) {
        previousValues.set(line.key, line.value);
      }
    }

    const lines: MetricLine[] = METRIC_KEYS.map((key) => {
      const value = valueForKey(current, key);
      const previousValue = previousValues.get(key);
      const delta = value !== undefined && previousValue !== undefined ? value - previousValue : undefined;
      const guardrail = guardrailFor(key, value, previousValue);
      return {
        key,
        value,
        previousValue,
        delta,
        trend: trendFor(value, previousValue),
        ...(guardrail !== undefined ? { guardrail } : {}),
      };
    });

    // The empty-window guarantee, enforced at the product boundary: if every
    // metric is a hole there is nothing to report.
    if (lines.every((line) => line.value === undefined)) {
      throw new EmptyWindowError();
    }

    return {
      window: { from: current.window.from, to: current.window.to },
      generatedAt: generatedAt.toISOString(),
      lines,
      // Day-25 (§3.2): shadow/infra ride as top-level sections — never metric
      // lines — so the stable five-line `lines` array above is untouched. The
      // ranking invariant is rendered visibly rather than merely assumed.
      shadow: current.shadow ?? { comparisons: 0 },
      infra: current.infra ?? {},
      rankMethod: current.rankMethod ?? 'keyword',
    };
  }
}
