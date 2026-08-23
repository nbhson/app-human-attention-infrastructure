/**
 * Pure parser from the model's raw text to a validated {@link ReviewAgentOutput}
 * (review-reorient Phase 3).
 *
 * The model is asked for a single JSON object, but models wrap it in fences or
 * prose; this parses defensively and clamps every field to the domain's closed
 * value sets so a malformed severity never reaches the database CHECK.
 */

import { ReviewSeverity, ReviewVerdict } from '@harness/domain';
import type {
  ReviewSeverity as ReviewSeverityT,
  ReviewVerdict as ReviewVerdictT,
} from '@harness/domain';

import type {
  FixSuggestionOutput,
  ReviewAgentOutput,
  ReviewFindingOutput,
} from './review-output.js';

const SEVERITIES = new Set<string>(Object.values(ReviewSeverity));
const VERDICTS = new Set<string>(Object.values(ReviewVerdict));

/** The model's output was not parseable as a review object. */
export class ReviewParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ReviewParseError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function normalizeSeverity(raw: unknown): ReviewSeverityT {
  if (typeof raw === 'string' && SEVERITIES.has(raw)) {
    return raw as ReviewSeverityT;
  }
  return ReviewSeverity.Info;
}

function normalizeVerdict(raw: unknown): ReviewVerdictT {
  if (typeof raw === 'string' && VERDICTS.has(raw)) {
    return raw as ReviewVerdictT;
  }
  return ReviewVerdict.Comment;
}

function normalizeFindings(raw: unknown): ReviewFindingOutput[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ReviewFindingOutput[] = [];
  for (const item of raw) {
    const f = (item ?? {}) as Record<string, unknown>;
    const file = typeof f.file === 'string' ? f.file : '';
    const message = typeof f.message === 'string' ? f.message : '';
    if (file.length === 0 || message.length === 0) {
      continue;
    }
    out.push({
      severity: normalizeSeverity(f.severity),
      file,
      message,
      ...(typeof f.line === 'number' ? { line: f.line } : {}),
      ...(typeof f.suggestion === 'string' && f.suggestion.length > 0
        ? { suggestion: f.suggestion }
        : {}),
    });
  }
  return out;
}

function normalizeSuggestions(raw: unknown): FixSuggestionOutput[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: FixSuggestionOutput[] = [];
  for (const item of raw) {
    const s = (item ?? {}) as Record<string, unknown>;
    const file = typeof s.file === 'string' ? s.file : '';
    const proposed = typeof s.proposed === 'string' ? s.proposed : '';
    const rationale = typeof s.rationale === 'string' ? s.rationale : '';
    if (file.length === 0 && proposed.length === 0) {
      continue;
    }
    out.push({
      file,
      proposed,
      rationale,
      ...(typeof s.hunk === 'string' && s.hunk.length > 0 ? { hunk: s.hunk } : {}),
    });
  }
  return out;
}

/** Strip markdown fences / prose and extract the first `{ ... }` JSON object. */
function extractJson(raw: string): string {
  const withoutFences = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return withoutFences.slice(start, end + 1);
  }
  return withoutFences;
}

export function parseReviewOutput(raw: string): ReviewAgentOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (cause) {
    throw new ReviewParseError('AI review output was not valid JSON', cause);
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    overallVerdict: normalizeVerdict(obj.overallVerdict),
    findings: normalizeFindings(obj.findings),
    suggestions: normalizeSuggestions(obj.suggestions),
  };
}
