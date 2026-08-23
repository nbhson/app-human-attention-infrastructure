/**
 * The severity/routing rubric (day-21 §2.2) and its versioned prompt.
 *
 * The judge grades **how good a review is** — severity agreement, routing
 * agreement, and evidence sufficiency — never the PR or its author. Scores are
 * numeric (each in `[0,1]`) so they can feed agreement stats (day-22) and weight
 * fitting (day-23); the prompt is versioned because a score is uninterpretable
 * without knowing which rubric produced it.
 */

import type { JudgeScores, ReviewReport } from '@harness/domain';

/**
 * The rubric prompt version. Bump this whenever the rubric's wording, dimensions,
 * or weights change — retroactive score comparisons are only meaningful when
 * scores map to a prompt version (day-21 §6).
 */
export const RUBRIC_PROMPT_VERSION = 'judge-rubric-v1';

/** The dimension weights that fold into `overall`. */
export const RUBRIC_WEIGHTS = {
  severity: 0.4,
  routing: 0.4,
  evidence: 0.2,
} as const;

/** The system prompt that scopes the judge to review-quality, not code-quality. */
export const RUBRIC_SYSTEM_PROMPT =
  "You are a review-quality judge. You grade a code reviewer's report on its own " +
  'merits — never the underlying code, the PR, or its author. Answer with strict JSON only.';

/** The names of the dimension keys the model must return (for a clear error on drift). */
const SCORE_KEYS = [
  'severityAgreement',
  'routingAgreement',
  'evidenceSufficiency',
  'overall',
] as const;

/**
 * Render the rubric + the report under judgment into the prompt the model answers.
 * Scoped deliberately: it shows the reviewer's *findings and verdict* (the artifact
 * being graded), not the diff, so the judge can't leak judgment onto the code.
 */
export function buildRubricPrompt(report: ReviewReport): string {
  const findings = report.findings
    .map(
      (f) =>
        `- [${f.severity}] ${f.file}${f.line === undefined ? '' : `:${f.line}`}: ${f.message}` +
        (f.suggestion === undefined ? '' : ` (suggested: ${f.suggestion})`),
    )
    .join('\n');

  return [
    'Score this code-review report against the following rubric. Each score is a ' +
      'number in [0,1].',
    '',
    'Dimensions:',
    '1. severityAgreement — did the report assign the correct severity band to each ' +
      'finding (CRITICAL/MAJOR/MINOR/NIT/INFO)? 1.0 = every severity is right; 0.0 = none are.',
    '2. routingAgreement — did the recommended verdict route the PR to the right human ' +
      'attention (APPROVE / REQUEST_CHANGES / COMMENT)? 1.0 = the verdict matches what the ' +
      'findings support; 0.0 = the verdict is wrong.',
    '3. evidenceSufficiency — is every claim backed by a specific file (and ideally line) ' +
      'plus a concrete message/suggestion? 1.0 = every finding is concrete and traceable; ' +
      '0.0 = findings are vague or unsupported.',
    '',
    `Recommended verdict: ${report.overallVerdict}`,
    `Summary: ${report.summary}`,
    '',
    'Findings:',
    findings.length === 0 ? '(none)' : findings,
    '',
    'Respond with ONLY a JSON object of this shape:',
    '{"severityAgreement":number,"routingAgreement":number,"evidenceSufficiency":number,' +
      '"overall":number,"reasoning":"one short sentence"}',
  ].join('\n');
}

/** The parsed and validated judge output. */
export interface ParsedJudgeOutput {
  readonly scores: JudgeScores;
  readonly reasoning: string;
}

/** Clamp a model-returned number into `[0,1]`. */
function clampUnit(value: unknown, label: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`judge output: ${label} is not a finite number (got ${String(value)})`);
  }
  return Math.max(0, Math.min(1, n));
}

/**
 * Parse the raw model text into `{ scores, reasoning }`. The model may wrap the
 * JSON in a markdown fence or stray prose, so the parser extracts the first
 * balanced-ish `{…}` region and validates every dimension (a missing or non-finite
 * dimension is an explicit error, not a silently-zeros score — day-21 §6).
 */
export function parseJudgeOutput(raw: string): ParsedJudgeOutput {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`judge output contained no JSON object: ${JSON.stringify(raw.slice(0, 120))}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    throw new Error(`judge output JSON was malformed: ${String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`judge output was not a JSON object: ${JSON.stringify(raw.slice(0, 120))}`);
  }
  const record = parsed as Record<string, unknown>;

  for (const key of SCORE_KEYS) {
    if (!(key in record)) {
      throw new Error(`judge output missing dimension "${key}"`);
    }
  }
  const reasoning = record.reasoning;
  if (typeof reasoning !== 'string') {
    throw new Error('judge output missing string "reasoning"');
  }

  return {
    scores: {
      severityAgreement: clampUnit(record.severityAgreement, 'severityAgreement'),
      routingAgreement: clampUnit(record.routingAgreement, 'routingAgreement'),
      evidenceSufficiency: clampUnit(record.evidenceSufficiency, 'evidenceSufficiency'),
      overall: clampUnit(record.overall, 'overall'),
    },
    reasoning,
  };
}
