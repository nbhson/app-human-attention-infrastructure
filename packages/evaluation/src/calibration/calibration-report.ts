/**
 * Week-5 calibration report (day-25 §2.1, §3.1) — the checkpoint *decision*,
 * not just numbers.
 *
 * Day 22/23/24 produced three measurements in isolation (inter-judge agreement,
 * judge-signal weight fit, judge-vs-gold agreement). This module is the combiner
 * that turns them into the Week-5 demo contract §2.1: **measure → fit → compare →
 * decide**. It runs the judge-signal refit via {@link fitJudgeWeights}, folds its
 * {@link JudgeFitReport} through the Phase-2 {@link compare} gate (the same
 * higher-is-better A/B the shadow harness uses), and gates the result on *judge
 * trustworthiness* — the judge may drive the weights only if it agrees with gold
 * and with itself above floor.
 *
 * The verdict is `PROMOTE` only when **all three** hold:
 *  1. the refit beat the incumbent on held-out ranking *without* the judge signal
 *     dominating a single column (`judgeFit.verdict === 'uplift'`),
 *  2. the A/B comparison says the candidate leads (`compare(...).go`), and
 *  3. the judge is trustworthy (judge-vs-gold usefulness ≥ floor *and* inter-judge
 *     severity agreement ≥ floor).
 *
 * Everything else is `HOLD` — and a `HOLD` on a small-N seed is a *successful*
 * checkpoint (day-25 §6): the gate worked, the measurement decided, nothing is
 * flipped by fiat.
 */

import type { JudgeAgreement } from '@harness/domain';

import { compare } from '../harness/compare.js';
import { buildJudgeFitReport } from './judge-fit-report.js';
import type { JudgeFitReport } from './judge-fit-report.js';
import { fitJudgeWeights } from './weight-fitter.js';
import type { FitConfig, JudgeAugmentedSample } from './weight-fitter.js';

/** Minimum judge-vs-gold usefulness agreement before the judge may drive weights. */
export const JUDGE_TRUST_USEFULNESS_FLOOR = 0.5;
/** Minimum inter-judge severity agreement before the judge may drive weights. */
export const INTER_JUDGE_SEVERITY_FLOOR = 0.7;
/** The predefined A/B metric: the candidate's held-out usefulness ranking accuracy. */
export const CALIBRATION_AB_METRIC = 'held_out_usefulness_ranking_accuracy';
/** The checkpoint A/B experiment label (a fixed, offline run — not a stored row). */
const CALIBRATION_EXPERIMENT_ID = 'calibration-w5';

/** The judge-vs-gold agreement (day-24 §3.3), pre-computed over the gold corpus. */
export interface GoldAgreementSummary {
  /** `1 − mean |judge.severityAgreement − gold.severity|`. */
  readonly severity: number;
  /** `1 − mean |judge.routingAgreement − gold.routing|`. */
  readonly routing: number;
  /** Fraction of examples where (judge.overall ≥ 0.5) === gold.useful. */
  readonly usefulness: number;
  /** Number of judged examples the agreement is computed over. */
  readonly n: number;
}

/** The A/B gate facts carried into the report (subset of {@link AbOutcome}). */
export interface CalibrationAb {
  readonly metric: string;
  /** Incumbent (control) held-out ranking accuracy. */
  readonly incumbent: number;
  /** Candidate (challenger) held-out ranking accuracy. */
  readonly candidate: number;
  /** `candidate − incumbent`. */
  readonly delta: number;
  readonly winner: 'A' | 'B' | 'TIE';
  /** True iff the candidate leads on a higher-is-better metric. */
  readonly go: boolean;
}

/** The definitive checkpoint decision. */
export type CalibrationDecision = 'PROMOTE' | 'HOLD';

/**
 * The full Week-5 report: the three agreements, the A/B comparison, and the
 * auditable decision + per-gate reasons (a decision with a trace, not an
 * assertion).
 */
export interface CalibrationReport {
  readonly corpusVersion: string;
  readonly seed: number;
  readonly judgeVsGold: GoldAgreementSummary;
  readonly interJudge: JudgeAgreement;
  readonly fit: JudgeFitReport;
  readonly ab: CalibrationAb;
  readonly judgeTrustworthy: boolean;
  readonly decision: CalibrationDecision;
  readonly reasons: readonly string[];
}

/** Input for {@link buildCalibrationReport} (the three already-measured numbers). */
export interface BuildCalibrationReportInput {
  readonly judgeVsGold: GoldAgreementSummary;
  readonly interJudge: JudgeAgreement;
  readonly judgeFit: JudgeFitReport;
  readonly corpusVersion: string;
}

/** Input for {@link runCalibration} — the end-to-end compute from fit samples. */
export interface CalibrationRunInput {
  readonly samples: readonly JudgeAugmentedSample[];
  readonly config: FitConfig;
  readonly judgeVsGold: GoldAgreementSummary;
  readonly interJudge: JudgeAgreement;
  readonly corpusVersion: string;
}

/** Assemble the report from three measured numbers and emit the decision. */
export function buildCalibrationReport(input: BuildCalibrationReportInput): CalibrationReport {
  const ab = compare({
    experimentId: CALIBRATION_EXPERIMENT_ID,
    metric: CALIBRATION_AB_METRIC,
    aValue: input.judgeFit.before.rankingAccuracy,
    bValue: input.judgeFit.after.rankingAccuracy,
    noProductionEffect: true,
  });

  const fitUplift = input.judgeFit.verdict === 'uplift';
  const abGo = ab.go;
  const judgeTrustworthy =
    input.judgeVsGold.usefulness >= JUDGE_TRUST_USEFULNESS_FLOOR &&
    input.interJudge.severity.agreement >= INTER_JUDGE_SEVERITY_FLOOR;

  const reasons: string[] = [];
  reasons.push(
    fitUplift
      ? `refit verdict UPLIFT — ${input.judgeFit.governanceNote}`
      : `refit verdict HOLD — ${input.judgeFit.governanceNote}`,
  );
  reasons.push(
    abGo
      ? `A/B "${CALIBRATION_AB_METRIC}" leads ${fmt(ab.delta, 4)} (candidate > incumbent)`
      : `A/B "${CALIBRATION_AB_METRIC}" does not lead (delta ${fmt(ab.delta, 4)})`,
  );
  reasons.push(
    judgeTrustworthy
      ? `judge trustworthy — usefulness agreement ${fmt(input.judgeVsGold.usefulness, 3)} ≥ ${JUDGE_TRUST_USEFULNESS_FLOOR} and inter-judge severity ${fmt(input.interJudge.severity.agreement, 3)} ≥ ${INTER_JUDGE_SEVERITY_FLOOR}`
      : `judge not yet trustworthy — usefulness agreement ${fmt(input.judgeVsGold.usefulness, 3)} (floor ${JUDGE_TRUST_USEFULNESS_FLOOR}) / inter-judge severity ${fmt(input.interJudge.severity.agreement, 3)} (floor ${INTER_JUDGE_SEVERITY_FLOOR})`,
  );

  const decision: CalibrationDecision = fitUplift && abGo && judgeTrustworthy ? 'PROMOTE' : 'HOLD';

  return {
    corpusVersion: input.corpusVersion,
    seed: input.judgeFit.seed,
    judgeVsGold: input.judgeVsGold,
    interJudge: input.interJudge,
    fit: input.judgeFit,
    ab: {
      metric: ab.metric,
      incumbent: ab.aValue,
      candidate: ab.bValue,
      delta: ab.delta,
      winner: ab.winner,
      go: ab.go,
    },
    judgeTrustworthy,
    decision,
    reasons,
  };
}

/**
 * Run the whole calibration compute (refit → fit report → decision) from judge-
 * augmented fit samples plus the two agreement measurements. This is the
 * "recompute from audit rows" path: the only inputs are the samples and the
 * agreements, so the report is reproducible from the same rows.
 *
 * @throws if `samples` is empty — a refit over zero samples is a caller error.
 */
export function runCalibration(input: CalibrationRunInput): CalibrationReport {
  if (input.samples.length === 0) {
    throw new Error('runCalibration requires at least one judge-augmented sample');
  }
  const fitResult = fitJudgeWeights(input.samples, input.config);
  const fitReport = buildJudgeFitReport(fitResult, input.config);
  return buildCalibrationReport({
    judgeVsGold: input.judgeVsGold,
    interJudge: input.interJudge,
    judgeFit: fitReport,
    corpusVersion: input.corpusVersion,
  });
}

function fmt(value: number, digits = 3): string {
  return value.toFixed(digits);
}

/** Render the report as a plain-text checkpoint block (the §3.2 surface). */
export function renderCalibrationReport(report: CalibrationReport): string {
  const dims = report.interJudge;
  const lines: string[] = [];
  lines.push('# Week-5 calibration checkpoint — judge + refit + gold');
  lines.push('');
  lines.push(`corpus:        ${report.corpusVersion}  (seed ${report.seed})`);
  lines.push('');
  lines.push('## 1. judge-vs-gold agreement (day 24)');
  lines.push(
    `    n=${report.judgeVsGold.n}  severity=${fmt(report.judgeVsGold.severity)}  ` +
      `routing=${fmt(report.judgeVsGold.routing)}  usefulness=${fmt(report.judgeVsGold.usefulness)}`,
  );
  lines.push('');
  lines.push('## 2. inter-judge agreement (day 22)');
  lines.push(
    `    severity: agreement=${fmt(dims.severity.agreement)}  κ=${fmt(dims.severity.kappa)}  n=${dims.severity.n}`,
  );
  lines.push(
    `    routing:  agreement=${fmt(dims.routing.agreement)}  κ=${fmt(dims.routing.kappa)}  n=${dims.routing.n}`,
  );
  lines.push('');
  lines.push('## 3. judge-signal refit (day 23)');
  lines.push(`    method:  ${report.fit.method}`);
  lines.push(`    split:   ${report.fit.trainCount} train / ${report.fit.validationCount} validation`);
  lines.push(
    `    ranking: incumbent ${fmt(report.fit.before.rankingAccuracy)} → ` +
      `candidate ${fmt(report.fit.after.rankingAccuracy)}`,
  );
  lines.push(
    `    logloss: incumbent ${fmt(report.fit.before.logLoss)} → ` + `candidate ${fmt(report.fit.after.logLoss)}`,
  );
  lines.push(
    `    fit verdict: ${report.fit.verdict.toUpperCase()}  ` +
      `(judge signal dominates: ${report.fit.judgeSignalDominates})`,
  );
  lines.push('');
  lines.push('## verdict');
  lines.push(`    ${report.decision}  (A/B "${report.ab.metric}" → ${report.ab.winner})`);
  for (const reason of report.reasons) lines.push(`    - ${reason}`);
  return lines.join('\n');
}
