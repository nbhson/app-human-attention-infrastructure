/**
 * The severity/routing rubric (day-21 §2.2) and its versioned prompt.
 *
 * The judge grades **how good a review is** — severity agreement, routing
 * agreement, and evidence sufficiency — never the PR or its author. Scores are
 * numeric (each in `[0,1]`) so they can feed agreement stats (day-22) and weight
 * fitting (day-23); the prompt is versioned because a score is uninterpretable
 * without knowing which rubric produced it.
 *
 * v2 changes: added few-shot examples (a clean report and a sloppy report),
 * added explicit "no markdown fence" + "low temperature" guidance, tightened
 * the anti-leak instruction so the judge cannot infer code from findings.
 */

import type { JudgeScores, ReviewReport } from '@harness/domain';

/**
 * The rubric prompt version. Bump this whenever the rubric's wording, dimensions,
 * or weights change — retroactive score comparisons are only meaningful when
 * scores map to a prompt version (day-21 §6).
 */
export const RUBRIC_PROMPT_VERSION = 'judge-rubric-v2';

/** The dimension weights that fold into `overall`. */
export const RUBRIC_WEIGHTS = {
  severity: 0.4,
  routing: 0.4,
  evidence: 0.2,
} as const;

/** The dimension names the model must return (for a clear error on drift). */
export const SCORE_DIMENSIONS = ['severityAgreement', 'routingAgreement', 'evidenceSufficiency', 'overall'] as const;

/**
 * The system prompt that scopes the judge to review-quality, not code-quality.
 * v2: adds temperature + format guardrails and reinforces the anti-leak
 * boundary (the judge never sees the diff and must not infer the code from
 * the findings).
 */
export const RUBRIC_SYSTEM_PROMPT = `You are a review-quality judge. You grade a code reviewer's REPORT on its own merits — the severity bands, the recommended verdict, and the evidence quality of each finding. You never grade the underlying code, the pull request, or the author. You are given the report's findings only; you do NOT see the diff. Do not infer or guess what the code does beyond what the findings explicitly state.

Scoring guidance:
- Each score is a number in [0, 1]. Use the full range; do not collapse to 0.9-1.0 for everything.
- A "perfect" report is not always 1.0 — 0.95 is acceptable when one minor dimension is slightly off.
- Be deterministic: this prompt is meant to be re-runnable. If your provider supports a temperature parameter, the harness sets it low (≤ 0.2).

Output format (strict):
- Respond with ONLY a JSON object. No prose before or after. No markdown fences (no \`\`\`json ... \`\`\`).
- The object must contain exactly these keys: severityAgreement, routingAgreement, evidenceSufficiency, overall, reasoning.
- "reasoning" must be one short sentence (≤ 200 chars) explaining the headline.

If the response cannot be parsed as the required JSON, the run is discarded — so format strictly.`;

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
    'Score this code-review REPORT against the following rubric. Each score is a number in [0, 1].',
    '',
    'Dimensions:',
    '1. severityAgreement — did the report assign the correct severity band to each finding (CRITICAL/MAJOR/MINOR/NIT/INFO)? 1.0 = every severity is right; 0.0 = none are. Use 0.5 when only some are right.',
    '2. routingAgreement — did the recommended verdict (APPROVE / REQUEST_CHANGES / COMMENT) route the PR to the right human attention? 1.0 = the verdict matches what the findings support; 0.0 = the verdict contradicts the findings. The verdict is "wrong" when the report requests approval but contains unresolved MAJOR/CRITICAL findings, or requests changes on findings that are truly trivial.',
    '3. evidenceSufficiency — is every claim backed by a specific file (and ideally line) plus a concrete message and optional suggestion? 1.0 = every finding is concrete and traceable; 0.0 = findings are vague or unsupported ("this might cause problems" with no file/line/reasoning).',
    '',
    `Recommended verdict: ${report.overallVerdict}`,
    `Summary: ${report.summary}`,
    '',
    'Findings:',
    findings.length === 0 ? '(none)' : findings,
    '',
    '═══════════════════════════════════════════════════════════════════',
    'EXAMPLES',
    '═══════════════════════════════════════════════════════════════════',
    '',
    'Example A — a clean, evidence-rich report (high scores):',
    'Recommended verdict: REQUEST_CHANGES',
    'Summary: Adds /widget; the payload dereference needs a guard.',
    'Findings:',
    '- [CRITICAL] src/widget.ts:42: Missing null check on user input. (suggested: guard against null)',
    '- [MINOR] README.md: Typo in endpoint description.',
    'Expected output:',
    '{"severityAgreement":0.95,"routingAgreement":1.0,"evidenceSufficiency":0.9,"overall":0.95,"reasoning":"Findings are concrete and well-anchored; verdict matches the CRITICAL finding."}',
    '',
    'Example B — a vague report with weak evidence (low scores):',
    'Recommended verdict: APPROVE',
    'Summary: Looks fine.',
    'Findings:',
    '- [MAJOR] src/api.ts: Could be more robust.',
    '- [MINOR] general: Maybe refactor some things.',
    'Expected output:',
    '{"severityAgreement":0.2,"routingAgreement":0.1,"evidenceSufficiency":0.1,"overall":0.15,"reasoning":"Findings lack file:line precision and the verdict is unjustified by the evidence."}',
    '',
    '═══════════════════════════════════════════════════════════════════',
    'NOW SCORE THE REPORT ABOVE',
    '═══════════════════════════════════════════════════════════════════',
    '',
    'Respond with ONLY a JSON object of this exact shape (no markdown, no prose):',
    '{"severityAgreement":number,"routingAgreement":number,"evidenceSufficiency":number,"overall":number,"reasoning":"one short sentence"}',
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
  // Strip leading/trailing markdown fences if present (defensive; the prompt
  // forbids them, but providers occasionally add them anyway).
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`judge output contained no JSON object: ${JSON.stringify(stripped.slice(0, 120))}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch (error) {
    throw new Error(`judge output JSON was malformed: ${String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`judge output was not a JSON object: ${JSON.stringify(stripped.slice(0, 120))}`);
  }
  const record = parsed as Record<string, unknown>;

  for (const key of SCORE_DIMENSIONS) {
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
