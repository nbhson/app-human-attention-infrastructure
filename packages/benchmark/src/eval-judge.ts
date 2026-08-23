/**
 * Judge-vs-gold evaluation (day-24 §3.3) — runs the judge over the corpus and
 * measures how close its scoring lands to the human's gold labels.
 *
 * The judge scores the *report*; the gold is what a careful human says the report
 * should have concluded. Agreement per dimension is the continuous rate
 * `1 − mean |judge − gold|` (severity and routing), matching the Day-22 agreement
 * statistic, plus a binary usefulness agreement: whether the judge's overall
 * score (`>= 0.5`) predicts the human's `useful` mark — the judge *predicts*, the
 * human *decides* (day-23 §6).
 *
 * The judge itself is injected through a {@link JudgeScorer} seam, so the math is
 * testable against a scripted scorer (no live LLM) while `judgeScorer` binds the
 * real {@link import('@harness/judge').Judge}.
 */

import { AiProviderType, createReviewFinding, createReviewReport } from '@harness/domain';
import type { JudgeScores, ReviewReport } from '@harness/domain';
import type { Judge } from '@harness/judge';

import type { ArtifactFinding, ReviewExample } from './review-example.js';

/** The overall-score cut above which the judge is taken to call a review useful. */
export const USEFULNESS_THRESHOLD = 0.5;

/**
 * Reconstruct a full {@link ReviewReport} from a stored judged artifact. The
 * provenance fields are benchmark placeholders — provenance is not the judged
 * artifact, and the judge grades the verdict + summary + findings only.
 */
export function reportFromExample(example: ReviewExample): ReviewReport {
  return createReviewReport({
    prUrl: `benchmark:${example.source}`,
    prTitle: example.requirement,
    aiProvider: AiProviderType.Anthropic,
    model: 'benchmark',
    summary: example.report.summary,
    overallVerdict: example.report.verdict,
    findings: example.report.findings.map(toFinding),
  });
}

function toFinding(finding: ArtifactFinding) {
  return createReviewFinding({
    severity: finding.severity,
    file: finding.file,
    message: finding.message,
    ...(finding.line !== undefined ? { line: finding.line } : {}),
    ...(finding.suggestion !== undefined ? { suggestion: finding.suggestion } : {}),
  });
}

/** One judged example: its gold + the judge's scores. */
export interface JudgedExample {
  readonly example: ReviewExample;
  readonly judge: JudgeScores;
}

/** Per-dimension judge-vs-gold agreement (severity/routing continuous, useful binary). */
export interface GoldAgreement {
  readonly severity: number;
  readonly routing: number;
  readonly usefulness: number;
}

/** The full judge-vs-gold result over one corpus. */
export interface JudgeVsGoldResult {
  readonly n: number;
  readonly agreement: GoldAgreement;
  readonly results: readonly JudgedExample[];
}

/** Produce the judge's scores for one example — the seam tests stub or `Judge` fills. */
export type JudgeScorer = (example: ReviewExample) => Promise<JudgeScores>;

/** Bind the real {@link Judge} to the corpus scorer (reconstructing each report). */
export function judgeScorer(judge: Judge): JudgeScorer {
  return (example) => judge.judgeReport(reportFromExample(example));
}

/** Compute per-dimension judge-vs-gold agreement over already-judged examples. */
export function computeGoldAgreement(results: readonly JudgedExample[]): GoldAgreement {
  if (results.length === 0) {
    throw new Error('computeGoldAgreement requires at least one judged example');
  }
  const n = results.length;
  let severityAbs = 0;
  let routingAbs = 0;
  let usefulHits = 0;
  for (const result of results) {
    severityAbs += Math.abs(result.judge.severityAgreement - result.example.gold.severity);
    routingAbs += Math.abs(result.judge.routingAgreement - result.example.gold.routing);
    const predictedUseful = result.judge.overall >= USEFULNESS_THRESHOLD;
    if (predictedUseful === result.example.gold.useful) usefulHits += 1;
  }
  return {
    severity: 1 - severityAbs / n,
    routing: 1 - routingAbs / n,
    usefulness: usefulHits / n,
  };
}

/**
 * Run the judge (via the seam) over every example and compute agreement vs gold.
 *
 * @throws if `examples` is empty — agreement over nothing is a caller error.
 */
export async function evaluateJudgeAgainstGold(
  examples: readonly ReviewExample[],
  score: JudgeScorer,
): Promise<JudgeVsGoldResult> {
  if (examples.length === 0) {
    throw new Error('evaluateJudgeAgainstGold requires at least one example');
  }
  const results = await Promise.all(
    examples.map(async (example) => ({ example, judge: await score(example) })),
  );
  return { n: results.length, agreement: computeGoldAgreement(results), results };
}
