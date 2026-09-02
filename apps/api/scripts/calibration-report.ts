/**
 * Week-5 checkpoint demo (Phase 3 day-25 §3.1) — `pnpm calibration:report`.
 *
 * Proves the Week-5 milestone end to end: **gold corpus → judge → agreement →
 * refit → A/B → PROMOTE/HOLD**. It wires three *real* packages through the app
 * host (the only layer allowed to import judge + benchmark + evaluation):
 *
 *   1. `@harness/benchmark` — `loadSeedExamples` (the day-24 redacted gold corpus)
 *      and `computeGoldAgreement` (judge-vs-gold severity/routing/usefulness).
 *   2. `@harness/judge` — `computeAgreement` (inter-judge agreement + Cohen's κ).
 *   3. `@harness/evaluation` — `runCalibration` (judge-signal refit → fit report →
 *      A/B gate → the PROMOTE/HOLD decision) and `renderCalibrationReport`.
 *
 * What is *stubbed*, and why, is on the line: the judge is a **deterministic
 * demonstration scorer** — two independent seeded raters that perturb the gold
 * by a bounded jitter — because a real `Judge` needs a live `LLMProvider` (API
 * key) and this repo never carries one (compile-tested-only .env hygiene). The
 * agreement and fit *math* is the real production code; only the LLM call is
 * swapped for a reproducible model of two raters. The factor scores that seed
 * the refit are derived from the gold rubric (not visible in a keyless demo —
 * the production path reads them from the Attention Engine's assessment of the
 * PR), again stated inline.
 */

import { computeAgreement } from '@harness/judge';
import type { JudgeScorePair } from '@harness/judge';

import { computeGoldAgreement, loadSeedExamples, SCALE_VERSION } from '@harness/benchmark';
import type { JudgedExample } from '@harness/benchmark';

import { runCalibration, renderCalibrationReport } from '@harness/evaluation';
import type { GoldAgreementSummary } from '@harness/evaluation';
import type { FactorScores, JudgeAugmentedSample, FitConfig } from '@harness/evaluation';
import type { JudgeScores } from '@harness/domain';

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

/**
 * Deterministic demonstration judge: severe/routing agreement jitter the gold,
 * evidence is well-attested, and `overall` sits above/below the 0.5 usefulness
 * cut by the gold's `useful` mark (with noise — so a miss is possible).
 */
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
    // No novelty/complexity signal is derivable from the bare gold rubric, so the
    // demo freezes them — the refit's *judge* signal lives in the confidence slot.
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

async function main(): Promise<void> {
  console.log();
  console.log('calibration:report — day-25 Week-5 checkpoint (judge + calibration end-to-end)');
  console.log();

  const examples = loadSeedExamples();
  console.log(`  corpus: ${examples.length} redacted gold-labelled review examples (scale ${SCALE_VERSION})`);
  console.log('  judge:  deterministic two-rater demonstration scorer (no live LLM / no API key)');
  console.log();

  // Two independent raters for inter-judge agreement, one for judge-vs-gold.
  const raterA = mulberry32(1);
  const raterB = mulberry32(2);
  const judgeScores = examples.map((e) => score(e.gold.severity, e.gold.routing, e.gold.useful, raterA));
  const secondScores = examples.map((e) => score(e.gold.severity, e.gold.routing, e.gold.useful, raterB));

  // 1 + 2. inter-judge agreement (judge), judge-vs-gold agreement (benchmark).
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

  // 3. refit → A/B → decide (evaluation).
  const report = runCalibration({
    samples: buildSamples(examples, judgeScores),
    config: FIT,
    judgeVsGold,
    interJudge,
    corpusVersion: SCALE_VERSION,
  });

  console.log(renderCalibrationReport(report));
  console.log();
  console.log('  provenance: report recomputed from the seed corpus ids + the two raters above,');
  console.log('             and from the judge-augmented samples — nothing is asserted, only measured.');
  console.log();
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('[calibration:report] FAILED:', error);
    process.exit(1);
  },
);
