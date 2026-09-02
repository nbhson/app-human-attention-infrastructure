/**
 * Day-39 §2.2 benchmark regression — `pnpm benchmark:regression`.
 *
 * Re-runs the *same* versioned gold corpus (scale `v1`, the day-24 seed) through
 * judge → inter-judge agreement → judge-vs-gold agreement → refit → A/B, then
 * diffs every measured number against the recorded **baseline** (the Day-25
 * Week-5 checkpoint) and prints a PASS / WARN / FAIL verdict per metric with its
 * explicit tolerance. A drift — worse agreement, a losing refit, a flipped A/B —
 * is a *finding to investigate*, not a number to bury (day-39 §2.1, §6).
 *
 * What is *stubbed*, and why, is on the line: the judge is the **deterministic
 * two-rater demonstration scorer** (two seeded PRNGs perturbing the gold) — a
 * real `Judge` needs a live `LLMProvider`, and this repo never carries an API key
 * (compile-tested-only `.env` hygiene). That makes the regression **exactly
 * reproducible** (Δ = 0.000 by construction) but also makes it a *pipeline*
 * regression, not a live-judge drift detector: it proves the review-quality
 * *math* still holds, and says nothing about model drift. Both halves of that
 * sentence are stated in the report — the honesty boundary is part of the day.
 *
 * The refit factor scores are derived from the gold rubric (as in the Day-25
 * checkpoint); the production path would read them from the Attention Engine's
 * assessment of the PR. The A/B gate is the *same* production {@code compare}
 * the shadow harness uses — only its two arms come from the seeded demo judge.
 */

import { computeAgreement } from '@harness/judge';
import type { JudgeScorePair } from '@harness/judge';

import { computeGoldAgreement, loadSeedExamples, SCALE_VERSION } from '@harness/benchmark';
import type { JudgedExample } from '@harness/benchmark';

import { runCalibration, renderCalibrationReport } from '@harness/evaluation';
import type { FactorScores, FitConfig, GoldAgreementSummary, JudgeAugmentedSample } from '@harness/evaluation';

import type { JudgeScores } from '@harness/domain';

// ---------------------------------------------------------------------------
// Deterministic demo judge (identical to the Day-25 checkpoint, seeds 1 & 2) —
// the reproducibility anchor that makes "same numbers, no drift" a real claim.
// ---------------------------------------------------------------------------

/** Deterministic 32-bit PRNG (mulberry32) — the demo judges are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const toJudgeScores = (severity: number, routing: number, evidence: number, overall: number): JudgeScores => ({
  severityAgreement: severity,
  routingAgreement: routing,
  evidenceSufficiency: evidence,
  overall,
});

/** Severity/routing agreement jitter the gold; overall tracks the `useful` mark. */
function score(severity: number, routing: number, useful: boolean, rng: () => number): JudgeScores {
  const jitter = (value: number) => clamp01(value + (rng() - 0.5) * 0.25);
  const overall = useful ? 0.55 + rng() * 0.3 : 0.2 + rng() * 0.25;
  return toJudgeScores(jitter(severity), jitter(routing), 0.65 + rng() * 0.25, overall);
}

/** The demo rubric→factor mapping (production reads factors from the Attention Engine). */
function factors(severity: number, routing: number, useful: boolean): FactorScores {
  return {
    risk: severity,
    impact: routing,
    novelty: 0.5,
    complexity: 0.5,
    confidence: useful ? 0.7 : 0.3,
  };
}

function buildSamples(examples: ReturnType<typeof loadSeedExamples>, judge: JudgeScores[]): JudgeAugmentedSample[] {
  return examples.map((example, index) => {
    const f = factors(example.gold.severity, example.gold.routing, example.gold.useful);
    const judgeScores = judge[index]!;
    return {
      incumbentFeatures: [f.risk, f.impact, f.novelty, f.complexity, 1 - f.confidence],
      judgeFeatures: [
        f.risk,
        f.impact,
        f.novelty,
        f.complexity,
        1 - (judgeScores.severityAgreement + judgeScores.routingAgreement) / 2,
      ],
      label: example.gold.useful ? 1 : 0,
    };
  });
}

const FIT: FitConfig = {
  seed: 42,
  validationShare: 0.5,
  iterations: 5000,
  learningRate: 0.1,
  regularization: 0.01,
};

// ---------------------------------------------------------------------------
// The recorded baseline — the Day-25 Week-5 checkpoint (docs/retros/phase3-w5.md),
// reproduced by `pnpm calibration:report`. Same corpus version is a hard
// pre-condition: a diff across `scale_version` changes would mix rubric drift
// with quality drift (day-39 §6).
// ---------------------------------------------------------------------------

const BASELINE = {
  corpusVersion: 'v1',
  judgeVsGold: { severity: 0.935, routing: 0.958, usefulness: 1.0 },
  interJudgeSeverity: 0.92,
  interJudgeRouting: 0.945,
  interJudgeKappa: 1.0,
  refit: {
    rankingIncumbent: 1.0,
    rankingCandidate: 1.0,
    logLossIncumbent: 0.44,
    logLossCandidate: 0.205,
  },
  abWinner: 'TIE',
  abDelta: 0.0,
  decision: 'HOLD',
} as const;

/** Continuous-agreement tolerance bands (proportional, not absolute). */
const TOLERANCE = {
  /** Drift within this band of a `[0,1]` agreement is still PASS. */
  passBand: 0.03,
  /** Drift beyond this band is a FAIL; in between is a WARN. */
  failBand: 0.05,
} as const;

type Verdict = 'PASS' | 'WARN' | 'FAIL';

interface Line {
  readonly metric: string;
  readonly baseline: string;
  readonly current: string;
  readonly delta: string;
  readonly note: string;
}

/** Classify a `[0,1]` agreement against its baseline (higher is better). */
function classifyAgreement(current: number, baseline: number): Verdict {
  const drift = baseline - current;
  if (drift <= TOLERANCE.passBand) return 'PASS';
  if (drift <= TOLERANCE.failBand) return 'WARN';
  return 'FAIL';
}

/** Classify a floor-gated metric: PASS iff above its absolute floor. */
function classifyFloor(current: number, floor: number): Verdict {
  return current >= floor ? 'PASS' : 'FAIL';
}

function fmt3(value: number): string {
  return value.toFixed(3);
}

function fmt4(value: number): string {
  return value.toFixed(4);
}

async function main(): Promise<void> {
  console.log();
  console.log('benchmark:regression — day-39 §2.2 (corpus regression + baseline compare)');
  console.log();

  const corpusVersion = SCALE_VERSION;
  if (corpusVersion !== BASELINE.corpusVersion) {
    throw new Error(
      `baseline was recorded on scale ${BASELINE.corpusVersion} but the current corpus ` +
        `is scale ${corpusVersion} — a cross-version diff is meaningless (day-39 §6)`,
    );
  }

  const examples = loadSeedExamples();
  console.log(`  corpus: ${examples.length} redacted gold-labelled review examples (scale ${corpusVersion})`);
  console.log('  judge:  deterministic two-rater demonstration scorer (no live LLM / no API key)');
  console.log(
    `  baseline: Day-25 Week-5 checkpoint (severity/routing ${fmt3(BASELINE.interJudgeSeverity)}/` +
      `${fmt3(BASELINE.interJudgeRouting)}, usefulness ${fmt3(BASELINE.judgeVsGold.usefulness)})`,
  );
  console.log();

  // Run the full pipeline — the same compute `pnpm calibration:report` uses.
  const raterA = mulberry32(1);
  const raterB = mulberry32(2);
  const judgeScores = examples.map((e) => score(e.gold.severity, e.gold.routing, e.gold.useful, raterA));
  const secondScores = examples.map((e) => score(e.gold.severity, e.gold.routing, e.gold.useful, raterB));

  const pairs: JudgeScorePair[] = examples.map((_, index) => ({
    a: judgeScores[index]!,
    b: secondScores[index]!,
  }));
  const interJudge = computeAgreement(pairs);

  const judged: JudgedExample[] = examples.map((example, index) => ({
    example,
    judge: judgeScores[index]!,
  }));
  const gold = computeGoldAgreement(judged);
  const judgeVsGold: GoldAgreementSummary = {
    severity: gold.severity,
    routing: gold.routing,
    usefulness: gold.usefulness,
    n: examples.length,
  };

  const report = runCalibration({
    samples: buildSamples(examples, judgeScores),
    config: FIT,
    judgeVsGold,
    interJudge,
    corpusVersion,
  });

  // ----------------------------------------------------------------------- //
  // Regression diff — one verdict per metric, with its explicit tolerance.   //
  // ----------------------------------------------------------------------- //

  const lines: Line[] = [];
  const verdicts: Verdict[] = [];

  const push = (metric: string, baseline: number, current: number, verdict: Verdict, note: string): void => {
    verdicts.push(verdict);
    lines.push({
      metric,
      baseline: fmt3(baseline),
      current: fmt3(current),
      delta: fmt4(current - baseline),
      note,
    });
  };

  push(
    'judge-vs-gold severity',
    BASELINE.judgeVsGold.severity,
    judgeVsGold.severity,
    classifyAgreement(judgeVsGold.severity, BASELINE.judgeVsGold.severity),
    `tolerance ±${fmt3(TOLERANCE.passBand)} (WARN ≤ ±${fmt3(TOLERANCE.failBand)})`,
  );
  push(
    'judge-vs-gold routing',
    BASELINE.judgeVsGold.routing,
    judgeVsGold.routing,
    classifyAgreement(judgeVsGold.routing, BASELINE.judgeVsGold.routing),
    `tolerance ±${fmt3(TOLERANCE.passBand)} (WARN ≤ ±${fmt3(TOLERANCE.failBand)})`,
  );
  push(
    'judge-vs-gold usefulness',
    BASELINE.judgeVsGold.usefulness,
    judgeVsGold.usefulness,
    classifyFloor(judgeVsGold.usefulness, 0.5),
    'floor 0.5 (JUDGE_TRUST_USEFULNESS_FLOOR)',
  );
  push(
    'inter-judge severity agreement',
    BASELINE.interJudgeSeverity,
    interJudge.severity.agreement,
    classifyAgreement(interJudge.severity.agreement, BASELINE.interJudgeSeverity),
    `floor 0.7 (INTER_JUDGE_SEVERITY_FLOOR)`,
  );
  push(
    'inter-judge routing agreement',
    BASELINE.interJudgeRouting,
    interJudge.routing.agreement,
    classifyAgreement(interJudge.routing.agreement, BASELINE.interJudgeRouting),
    `tolerance ±${fmt3(TOLERANCE.passBand)}`,
  );
  push(
    'inter-judge κ (severity)',
    BASELINE.interJudgeKappa,
    interJudge.severity.kappa,
    classifyAgreement(interJudge.severity.kappa, BASELINE.interJudgeKappa),
    'degenerate (constant raters) — κ 1.0 is the only meaningful value',
  );

  // Refit: no regression = candidate still leads (or ties) the incumbent.
  const rankingRegressed = report.fit.after.rankingAccuracy < report.fit.before.rankingAccuracy;
  const logLossRegressed = report.fit.after.logLoss > report.fit.before.logLoss;
  const refitVerdict: Verdict = rankingRegressed || logLossRegressed ? 'FAIL' : 'PASS';
  verdicts.push(refitVerdict);
  lines.push({
    metric: 'refit ranking (incumbent → candidate)',
    baseline: `${fmt3(BASELINE.refit.rankingIncumbent)} → ${fmt3(BASELINE.refit.rankingCandidate)}`,
    current: `${fmt3(report.fit.before.rankingAccuracy)} → ${fmt3(report.fit.after.rankingAccuracy)}`,
    delta: `${fmt4(report.fit.after.rankingAccuracy - report.fit.before.rankingAccuracy)} (Δ incumbent)`,
    note: report.fit.verdict === 'uplift' ? report.fit.governanceNote : `held: ${report.fit.governanceNote}`,
  });
  verdicts.push(logLossRegressed ? 'FAIL' : 'PASS');
  lines.push({
    metric: 'refit log-loss (incumbent → candidate)',
    baseline: `${fmt3(BASELINE.refit.logLossIncumbent)} → ${fmt3(BASELINE.refit.logLossCandidate)}`,
    current: `${fmt3(report.fit.before.logLoss)} → ${fmt3(report.fit.after.logLoss)}`,
    delta: `${fmt4(report.fit.after.logLoss - report.fit.before.logLoss)} (lower is better)`,
    note: 'no regression iff candidate ≤ incumbent',
  });

  // A/B + decision: unchanged is PASS; a *better* delta/decision is noted, not failed.
  const abChangedWorse = report.ab.winner !== BASELINE.abWinner && report.ab.winner === 'B';
  const abVerdict: Verdict = abChangedWorse ? 'FAIL' : report.ab.winner === BASELINE.abWinner ? 'PASS' : 'WARN';
  verdicts.push(abVerdict);
  lines.push({
    metric: 'A/B verdict (held-out ranking)',
    baseline: `${BASELINE.abWinner} (Δ ${fmt4(BASELINE.abDelta)})`,
    current: `${report.ab.winner} (Δ ${fmt4(report.ab.delta)})`,
    delta: fmt4(report.ab.delta - BASELINE.abDelta),
    note: `candidate ${report.ab.go ? 'leads' : 'does not lead'} the incumbent`,
  });
  verdicts.push(report.decision === BASELINE.decision ? 'PASS' : 'WARN');
  lines.push({
    metric: 'decision',
    baseline: BASELINE.decision,
    current: report.decision,
    delta: report.decision === BASELINE.decision ? 'unchanged' : 'CHANGED',
    note: 'a HOLD with a clean trace is the checkpoint done right; a PROMOTE is an improvement, not a regression',
  });

  const failed = verdicts.filter((v) => v === 'FAIL').length;
  const warned = verdicts.filter((v) => v === 'WARN').length;

  console.log('## regression diff (baseline → current)');
  console.log();
  for (const line of lines) {
    console.log(`  ${line.metric}`);
    console.log(`      baseline ${line.baseline}   current ${line.current}   Δ ${line.delta}   ${line.note}`);
  }
  console.log();
  const overall: Verdict = failed > 0 ? 'FAIL' : warned > 0 ? 'WARN' : 'PASS';
  console.log(
    `  overall: ${overall}  (${verdicts.length - failed - warned} pass / ${warned} warn / ` + `${failed} fail)`,
  );
  console.log();

  console.log('# current checkpoint (full report)');
  console.log();
  console.log(renderCalibrationReport(report));
  console.log();

  console.log('  honesty boundary — what this regression DOES and DOES NOT prove:');
  console.log('   - DOES prove the review-quality MATH is regression-free (identical numbers');
  console.log('     across the baseline and now, because the demo judge is a seeded PRNG).');
  console.log('   - DOES NOT detect live-judge drift — the only LLM call is a deterministic');
  console.log('     stand-in; a real corpus × live model regression needs a keyed environment');
  console.log('     this repo deliberately never carries.');
  console.log('   - corpus is review-quality gold labels only; no code-generation content');
  console.log('     anywhere in the regression (day-39 §2.4).');
  console.log();

  if (overall === 'FAIL') {
    process.exitCode = 1;
  }
}

void main().then(
  () => {
    // process.exitCode signals FAIL to CI without masking flush-to-stdout.
  },
  (error: unknown) => {
    console.error('[benchmark:regression] FAILED:', error);
    process.exit(1);
  },
);
