/**
 * Offline `MetricsComputer` (day-06 §2.2, §3.3–3.4).
 *
 * Turns a windowed, read-only row set into Spec 11's Phase-2 metrics. Pure and
 * deterministic: given the same rows in the same order it emits the same report,
 * so CI and the A/B harness can replay a window and get identical numbers.
 *
 * The two rules that keep these numbers honest:
 *  - **`undefined` is an honest hole, `NaN` is a lie** — a zero denominator omits
 *    the metric rather than emitting `Infinity`/`NaN`.
 *  - **Missing dwell is not zero dwell** — if any accepted decision lacks a
 *    claim→decide span, `humanMinutesPerAccept` is omitted rather than padded.
 */

import { setGauge } from '@harness/observability';

import { hasLaterDefect, isHumanRoute, isRejection } from './labels.js';
import type {
  DecisionRow,
  EfficiencyMetrics,
  InfraCounters,
  InfraMetrics,
  MetricsInput,
  MetricsReport,
  RoutingMetrics,
  ShadowMetrics,
  ShadowRow,
} from './report.js';

const INFLATED_LABELS: ReadonlySet<string> = new Set(['CRITICAL', 'HIGH']);

export class MetricsComputer {
  /** Compute all Spec-11 metrics for the given windowed input. */
  compute(input: MetricsInput): MetricsReport {
    // Latest decision per assessment wins (a re-reviewed change's newer outcome
    // supersedes the older one).
    const decisionByAssessment = new Map<string, DecisionRow>();
    for (const decision of input.decisionLog) {
      const existing = decisionByAssessment.get(decision.assessmentId);
      if (!existing || decision.createdAt.getTime() >= existing.createdAt.getTime()) {
        decisionByAssessment.set(decision.assessmentId, decision);
      }
    }

    let humanCount = 0;
    let warrantedHuman = 0;
    let flythroughCount = 0;
    let flythroughDefects = 0;

    let acceptedCount = 0;
    let acceptedMissingDwell = 0;
    let dwellSumSeconds = 0;

    let labeledCount = 0;
    let inflatedCount = 0;

    for (const route of input.routeLog) {
      if (route.label !== undefined) {
        labeledCount += 1;
        if (INFLATED_LABELS.has(route.label)) inflatedCount += 1;
      }

      if (isHumanRoute(route.action)) {
        humanCount += 1;
        const decision = decisionByAssessment.get(route.assessmentId);
        const warranted =
          (decision !== undefined && isRejection(decision.decision)) ||
          hasLaterDefect(route.taskId, route.occurredAt, input.reworkLog);
        if (warranted) warrantedHuman += 1;

        if (decision !== undefined && decision.decision === 'APPROVED') {
          acceptedCount += 1;
          if (decision.dwellSeconds === undefined) {
            acceptedMissingDwell += 1;
          } else {
            dwellSumSeconds += decision.dwellSeconds;
          }
        }
      } else {
        flythroughCount += 1;
        if (hasLaterDefect(route.taskId, route.occurredAt, input.reworkLog)) {
          flythroughDefects += 1;
        }
      }
    }

    const routing: RoutingMetrics = {
      ...(humanCount > 0 ? { precision: warrantedHuman / humanCount } : {}),
      ...(warrantedHuman + flythroughDefects > 0
        ? { recall: warrantedHuman / (warrantedHuman + flythroughDefects) }
        : {}),
      ...(flythroughCount > 0 ? { escalationLeakage: flythroughDefects / flythroughCount } : {}),
    };

    const efficiency: EfficiencyMetrics = {
      ...(acceptedCount > 0 && acceptedMissingDwell === 0
        ? { humanMinutesPerAccept: dwellSumSeconds / 60 / acceptedCount }
        : {}),
      ...(labeledCount > 0 ? { inflationRatio: inflatedCount / labeledCount } : {}),
    };

    return {
      window: { from: input.from.toISOString(), to: input.to.toISOString() },
      routing,
      efficiency,
      shadow: computeShadow(input.shadowLog ?? []),
      infra: computeInfra(input.infraCounters),
      rankMethod: 'keyword',
    };
  }
}

/**
 * Collapse the window's shadow comparisons into one signal: how many ran, and the
 * mean Kendall tau over the overlapping orderings (§3.2). `meanRankCorrelation`
 * is omitted when no comparison produced a tau (fewer than 2 shared items).
 */
function computeShadow(rows: readonly ShadowRow[]): ShadowMetrics {
  const correlations = rows
    .filter((row) => row.rankCorrelation !== null)
    .map((row) => row.rankCorrelation as number);
  const mean =
    correlations.length > 0
      ? correlations.reduce((sum, value) => sum + value, 0) / correlations.length
      : undefined;
  return {
    comparisons: rows.length,
    ...(mean !== undefined ? { meanRankCorrelation: mean } : {}),
  };
}

/** Derive the day-25 infra ratios from a cumulative counter snapshot (§3.2). */
function computeInfra(counters: InfraCounters | undefined): InfraMetrics {
  if (counters === undefined) {
    return {};
  }
  const cacheTotal = counters.cacheHits + counters.cacheMisses;
  const sandboxTotal = counters.sandboxRuns + counters.sandboxFallbacks;
  return {
    ...(cacheTotal > 0 ? { cacheHitRatio: counters.cacheHits / cacheTotal } : {}),
    ...(sandboxTotal > 0 ? { sandboxFallbackRate: counters.sandboxFallbacks / sandboxTotal } : {}),
    ...(counters.sandboxRuns > 0
      ? { sandboxAvgDurationMs: counters.sandboxDurationMs / counters.sandboxRuns }
      : {}),
    ...(counters.objectIntegrityErrors > 0
      ? { objectIntegrityErrors: counters.objectIntegrityErrors }
      : {}),
  };
}

/** Push a report's defined metrics onto the Day-04 Prometheus gauges. */
export function applyGauges(report: MetricsReport): void {
  if (report.routing.precision !== undefined) {
    setGauge('harness_routing_precision', report.routing.precision);
  }
  if (report.routing.recall !== undefined) {
    setGauge('harness_routing_recall', report.routing.recall);
  }
  if (report.routing.escalationLeakage !== undefined) {
    setGauge('harness_routing_escalation_leakage', report.routing.escalationLeakage);
  }
  if (report.efficiency.humanMinutesPerAccept !== undefined) {
    setGauge('harness_attention_human_minutes_per_accept', report.efficiency.humanMinutesPerAccept);
  }
  if (report.efficiency.inflationRatio !== undefined) {
    setGauge('harness_attention_inflation_ratio', report.efficiency.inflationRatio);
  }
}
