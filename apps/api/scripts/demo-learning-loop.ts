/**
 * Learning-loop demo (Phase 3 day-31 §3.1–§3.3) — `pnpm demo:learning-loop`.
 *
 * Runs the **real** loop end-to-end, keyless and hermetically: the `CalibrationJob`
 * (attention-engine, the day-31 orchestration) drives evaluation's actual
 * `fitJudgeWeights` across the package boundary, exactly as the app host would.
 * No database, no LLM — the collect seam returns a deterministic fixture of review
 * facts, and the fit seam is a thin adapter onto `fitJudgeWeights`.
 *
 * It demonstrates the three day-31 claims in one run:
 *   1. New evidence → the job **fits a candidate** and carries its provenance.
 *   2. The candidate sits behind the **promotion gate**: the honest result over a
 *      tiny fixture is HOLD (or a judge-dominance HOLD), never a manufactured WIN.
 *   3. A *forced-win* fit — the same gate — turns into PROMOTE, i.e. the only path
 *      to promotion is a measured WIN, and the job itself never applies weights.
 */

import { CalibrationJob } from '@harness/attention-engine';
import type {
  AttentionWeights,
  CollectSeam,
  FitSeam,
  LearningCandidate,
  LearningFitConfig,
  LearningSample,
  ReviewFact,
} from '@harness/attention-engine';
import { PRIORITY_WEIGHTS } from '@harness/attention-engine';
import { fitJudgeWeights } from '@harness/evaluation';
import type { FitConfig, JudgeAugmentedSample } from '@harness/evaluation';

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`[demo:learning-loop] assertion failed: ${label}`);
  }
}

/** Six review facts: three useful (well-judged) + three not (judge flags routing). */
const FACTS: readonly ReviewFact[] = [
  fact('r1', true, 0.92, 0.9, 0.4, 0.2, 0.3, 0.3, 0.85),
  fact('r2', true, 0.9, 0.88, 0.5, 0.3, 0.3, 0.4, 0.8),
  fact('r3', true, 0.95, 0.9, 0.6, 0.2, 0.4, 0.3, 0.9),
  fact('r4', false, 0.55, 0.5, 0.7, 0.4, 0.8, 0.7, 0.3),
  fact('r5', false, 0.6, 0.52, 0.8, 0.5, 0.7, 0.8, 0.25),
  fact('r6', false, 0.5, 0.48, 0.9, 0.6, 0.9, 0.8, 0.35),
];

function fact(
  reviewId: string,
  wasUseful: boolean,
  severity: number,
  routing: number,
  risk: number,
  impact: number,
  novelty: number,
  complexity: number,
  confidence: number,
): ReviewFact {
  return {
    reviewId,
    factors: { risk, impact, novelty, complexity, confidence },
    judge: { severityAgreement: severity, routingAgreement: routing },
    wasUseful,
    recordedAt: new Date('2026-08-20T00:00:00.000Z'),
  };
}

/** The incumbent vector the candidate is measured against (Phase-1 placeholder). */
const INCUMBENT: AttentionWeights = PRIORITY_WEIGHTS;

/** The collect seam: returns the fixture (the app would read the DB here). */
const collect: CollectSeam = { collect: async () => FACTS };

/**
 * The fit seam: adapts attention-engine's `LearningSample` onto evaluation's
 * `JudgeAugmentedSample`, calls the real `fitJudgeWeights`, and maps the result
 * back — the one place the boundary between the two packages is crossed.
 */
function makeRealFit(): FitSeam {
  return {
    fit(
      samples: readonly LearningSample[],
      _config: LearningFitConfig,
      incumbent: AttentionWeights,
    ): LearningCandidate {
      const judgeSamples: JudgeAugmentedSample[] = samples.map((s) => ({
        incumbentFeatures: s.incumbentFeatures,
        judgeFeatures: s.judgeFeatures,
        label: s.label,
      }));
      // Default Phase-2 solver/split config; structure-identical to FitConfig.
      const fitConfig: FitConfig = {
        seed: 42,
        validationShare: 0.2,
        iterations: 5000,
        learningRate: 0.1,
        regularization: 0.01,
      };
      const result = fitJudgeWeights(judgeSamples, fitConfig, incumbent);
      return {
        candidateWeights: result.candidateWeights,
        incumbentWeights: incumbent,
        improvement: result.improvement,
        judgeSignalDominates: result.judgeSignalDominates,
        candidateRankingAccuracy: result.candidate.rankingAccuracy,
        incumbentRankingAccuracy: result.incumbent.rankingAccuracy,
        candidateLogLoss: result.candidate.logLoss,
        incumbentLogLoss: result.incumbent.logLoss,
        sampleCount: samples.length,
      };
    },
  };
}

/** A forced-win fit seam — used to show the only path to PROMOTE is a measured WIN. */
function makeForcedWinFit(): FitSeam {
  return {
    fit(): LearningCandidate {
      return {
        candidateWeights: {
          risk: 0.4,
          impact: 0.2,
          novelty: 0.15,
          complexity: 0.1,
          confidence: 0.15,
        },
        incumbentWeights: INCUMBENT,
        improvement: true,
        judgeSignalDominates: false,
        candidateRankingAccuracy: 1,
        incumbentRankingAccuracy: 0.6,
        candidateLogLoss: 0.2,
        incumbentLogLoss: 0.5,
        sampleCount: FACTS.length,
      };
    },
  };
}

function round(value: number): string {
  return value.toFixed(4);
}

async function main(): Promise<void> {
  console.log();
  console.log('demo:learning-loop — day-31 Evaluate → Calibrate → (measured) Deploy');
  console.log();

  // 1 — honest fit over the fixture (real fitJudgeWeights behind the seam).
  const honest = new CalibrationJob(collect, makeRealFit(), INCUMBENT);
  const run = await honest.run();
  assert(run.window.reviewIds.length === FACTS.length, 'window collects all six facts');
  assert(run.candidate !== null, 'a candidate was fitted');
  console.log('  1. job fitted a candidate over the window:');
  console.log(`     review ids    : ${run.window.reviewIds.join(', ')}`);
  console.log(`     samples       : ${FACTS.length}`);
  const c = run.candidate!;
  console.log(
    `     ranking acc   : inc ${round(c.incumbentRankingAccuracy)} → cand ${round(c.candidateRankingAccuracy)}`,
  );
  console.log(
    `     log-loss      : inc ${round(c.incumbentLogLoss)} → cand ${round(c.candidateLogLoss)}`,
  );
  console.log(
    `     improvement   : ${c.improvement}   judgeSignalDominates: ${c.judgeSignalDominates}`,
  );
  console.log(
    `     → promotion   : ${run.promotion!.outcome} (${run.promotion!.reasons.join('; ')})`,
  );
  console.log(`     → promoted    : ${run.promoted} (job never applies weights itself)`);
  assert(!run.promoted, 'the honest fixture does not manufacture a WIN');
  console.log();

  // 2 — forced WIN: the gate lets a measured improvement through.
  const forced = await new CalibrationJob(collect, makeForcedWinFit(), INCUMBENT).run();
  assert(forced.promotion!.outcome === 'PROMOTE', 'a measured WIN promotes');
  assert(forced.promoted === true, 'promoted mirrors PROMOTE (and only PROMOTE)');
  console.log('  2. a measured WIN is the only path to PROMOTE:');
  console.log(
    `     → promotion   : ${forced.promotion!.outcome} (${forced.promotion!.reasons.join('; ')})`,
  );
  console.log(`     → promoted    : ${forced.promoted}`);
  console.log();

  console.log(
    'learning loop: new evidence → candidate (+ provenance) → measured gate; automation stops there. ✅',
  );
}

main().catch((err) => {
  console.error('[demo:learning-loop] FAILED:', err);
  process.exit(1);
});
