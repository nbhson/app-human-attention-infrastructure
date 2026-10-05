/**
 * Pure parser from the model's raw text to a validated {@link ReviewAgentOutput}
 * (review-reorient Phase 3).
 *
 * The model is asked for a single JSON object, but models wrap it in fences or
 * prose; this parses defensively and clamps every field to the domain's closed
 * value sets so a malformed severity never reaches the database CHECK.
 */

import { FindingKind, ReviewSeverity, ReviewVerdict } from '@harness/domain';
import type {
  FindingKind as FindingKindT,
  ReviewSeverity as ReviewSeverityT,
  ReviewVerdict as ReviewVerdictT,
  HealthRating,
  OverallRiskLevel,
  PRHealthScore,
} from '@harness/domain';

import type { FixSuggestionOutput, ReviewAgentOutput, ReviewFindingOutput } from './review-output.js';

const SEVERITIES = new Set<string>(Object.values(ReviewSeverity));
const KINDS = new Set<string>(Object.values(FindingKind));
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

function normalizeKind(raw: unknown): FindingKindT {
  if (typeof raw === 'string' && KINDS.has(raw)) {
    return raw as FindingKindT;
  }
  return FindingKind.Correctness;
}

/**
 * Coerce a model-emitted `line` to a number, or `undefined` when absent/unusable.
 * Models routinely emit `"line": 42` in one review and `"line": "42"` in the next;
 * requiring `typeof line === 'number'` silently drops the string form and leaves
 * the finding line-less (dragging the report's flagged-added-lines share to 0).
 */
function normalizeLine(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
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
    const line = normalizeLine(f.line);
    out.push({
      severity: normalizeSeverity(f.severity),
      kind: normalizeKind(f.kind),
      file,
      message,
      ...(line !== undefined ? { line } : {}),
      ...(typeof f.suggestion === 'string' && f.suggestion.length > 0 ? { suggestion: f.suggestion } : {}),
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

const HEALTH_RATINGS = new Set<HealthRating>(['excellent', 'good', 'fair', 'poor']);
const RISK_LEVELS = new Set<OverallRiskLevel>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

function normalizeHealthRating(raw: unknown): HealthRating {
  if (typeof raw === 'string' && HEALTH_RATINGS.has(raw as HealthRating)) {
    return raw as HealthRating;
  }
  return 'fair';
}

function normalizeRiskLevel(raw: unknown): OverallRiskLevel {
  if (typeof raw === 'string' && RISK_LEVELS.has(raw as OverallRiskLevel)) {
    return raw as OverallRiskLevel;
  }
  return 'MEDIUM';
}

function clampScore(raw: unknown): number | undefined {
  const n = typeof raw === 'string' && raw.trim().length > 0 ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.min(100, Math.max(1, Math.round(n)));
}

function ratingFromScore(score: number | undefined, fallback: HealthRating): HealthRating {
  if (score === undefined) return fallback;
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

function riskFromScore(score: number | undefined, fallback: OverallRiskLevel): OverallRiskLevel {
  if (score === undefined) return fallback;
  if (score >= 85) return 'CRITICAL';
  if (score >= 65) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

/** Band floors for risk labels under the prompt contract (LOW 1–34, MEDIUM 35–64, HIGH 65–84, CRITICAL 85–100). */
const RISK_BAND_FLOOR: Record<OverallRiskLevel, number> = { LOW: 1, MEDIUM: 35, HIGH: 65, CRITICAL: 85 };

/**
 * Highest `overallRiskScore` the filed evidence supports. A concrete finding
 * caps the composite — CRITICAL lifts the cap entirely, MAJOR caps at HIGH
 * (84), anything lower (or nothing filed) caps at LOW (34). The verdict can
 * only lift (`REQUEST_CHANGES` → 84, `COMMENT` → 64: the reviewer asserts
 * gravity beyond filed findings); `APPROVE` never lifts. So a flipped scale
 * ("90 = healthy" from a small model, with INFO/MINOR-only findings and an
 * APPROVE) collapses to LOW instead of rendering CRITICAL next to
 * all-excellent dimensions. Never raises — a modest score with real evidence
 * passes through untouched.
 */
function evidenceRiskCap(findings: readonly ReviewFindingOutput[], verdict: ReviewVerdictT): number {
  let cap = 34;
  for (const finding of findings) {
    if (finding.severity === ReviewSeverity.Critical) {
      return 100;
    }
    if (finding.severity === ReviewSeverity.Major) {
      cap = Math.max(cap, 84);
    }
  }
  if (verdict === ReviewVerdict.RequestChanges) {
    cap = Math.max(cap, 84);
  } else if (verdict === ReviewVerdict.Comment) {
    cap = Math.max(cap, 64);
  }
  return cap;
}

/**
 * Coerce a parsed `healthScore` to agree with its own findings + verdict.
 * Exported so the batch merge (`mergeOutputs`) can re-apply it to the
 * whole-review evidence after taking the per-batch max.
 */
export function cohereRiskToEvidence(
  healthScore: PRHealthScore,
  findings: readonly ReviewFindingOutput[],
  verdict: ReviewVerdictT,
): PRHealthScore {
  const cap = evidenceRiskCap(findings, verdict);
  const score = healthScore.overallRiskScore;
  if (score !== undefined) {
    if (score <= cap) {
      return healthScore;
    }
    const clamped = Math.max(1, Math.min(cap, score));
    return { ...healthScore, overallRiskScore: clamped, overallRisk: riskFromScore(clamped, healthScore.overallRisk) };
  }
  // Label-only legacy shape: demote a label whose band floor exceeds the cap.
  if (RISK_BAND_FLOOR[healthScore.overallRisk] > cap) {
    const level: OverallRiskLevel = cap >= 65 ? 'HIGH' : cap >= 35 ? 'MEDIUM' : 'LOW';
    return { ...healthScore, overallRisk: level };
  }
  return healthScore;
}

/**
 * Accept three shapes per dimension so old + new prompts both parse:
 * - legacy string: `"security": "good"`
 * - object: `"security": { "rating": "good", "score": 78 }`
 * - flat score sibling: `"securityScore": 78` alongside the rating.
 */
function normalizeDimension(
  obj: Record<string, unknown>,
  key: string,
): { rating: HealthRating; score: number | undefined } {
  const raw = obj[key];
  const flatScore = clampScore(obj[`${key}Score`]);
  if (typeof raw === 'object' && raw !== null) {
    const rec = raw as Record<string, unknown>;
    const score = clampScore(rec['score']) ?? flatScore;
    const rating = typeof rec['rating'] === 'string' ? normalizeHealthRating(rec['rating']) : undefined;
    if (rating !== undefined) {
      return { rating: score !== undefined ? ratingFromScore(score, rating) : rating, score };
    }
    if (score !== undefined) {
      return { rating: ratingFromScore(score, 'fair'), score };
    }
  }
  if (typeof raw === 'string') {
    const rating = normalizeHealthRating(raw);
    return { rating: flatScore !== undefined ? ratingFromScore(flatScore, rating) : rating, score: flatScore };
  }
  if (typeof raw === 'number') {
    const score = clampScore(raw);
    if (score !== undefined) return { rating: ratingFromScore(score, 'fair'), score };
  }
  if (flatScore !== undefined) {
    return { rating: ratingFromScore(flatScore, 'fair'), score: flatScore };
  }
  return { rating: 'fair', score: undefined };
}

function normalizeHealthScore(raw: unknown): PRHealthScore | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const arch = normalizeDimension(obj, 'architecture');
  const qual = normalizeDimension(obj, 'codeQuality');
  const sec = normalizeDimension(obj, 'security');
  const perf = normalizeDimension(obj, 'performance');
  const test = normalizeDimension(obj, 'testing');
  const riskRaw = obj['overallRisk'];
  const riskScore = clampScore(obj['overallRiskScore']);
  let risk: OverallRiskLevel;
  if (typeof riskRaw === 'object' && riskRaw !== null) {
    const rec = riskRaw as Record<string, unknown>;
    const s = clampScore(rec['score']) ?? riskScore;
    const r = typeof rec['level'] === 'string' ? normalizeRiskLevel(rec['level']) : normalizeRiskLevel(rec['rating']);
    risk = s !== undefined ? riskFromScore(s, r) : r;
  } else {
    const r = normalizeRiskLevel(riskRaw);
    risk = riskScore !== undefined ? riskFromScore(riskScore, r) : r;
  }
  return {
    architecture: arch.rating,
    codeQuality: qual.rating,
    security: sec.rating,
    performance: perf.rating,
    testing: test.rating,
    overallRisk: risk,
    ...(arch.score !== undefined ? { architectureScore: arch.score } : {}),
    ...(qual.score !== undefined ? { codeQualityScore: qual.score } : {}),
    ...(sec.score !== undefined ? { securityScore: sec.score } : {}),
    ...(perf.score !== undefined ? { performanceScore: perf.score } : {}),
    ...(test.score !== undefined ? { testingScore: test.score } : {}),
    ...(riskScore !== undefined ? { overallRiskScore: riskScore } : {}),
  };
}

/**
 * Strip markdown fences / prose and locate candidate JSON roots.
 *
 * The model is asked for a single JSON object but routinely wraps it in fences,
 * pads it with prose, or — for small fast models — returns a *bare array* or a
 * *run of `{...}` finding objects* concatenated as JSONL instead of the
 * `ReviewAgentOutput` envelope. This returns an ordered list of candidates,
 * most-likely first:
 *   1. the whole fence-stripped text (a model that obeyed the format parses whole),
 *   2. the whole text wrapped in `[...]` (a JSONL-style run of objects becomes a
 *      valid array when wrapped), so a multi-object reply merges into one array,
 *   3. each balanced `{ … }` object in order,
 *   4. the first balanced `[ … ]` array.
 */
function extractCandidates(raw: string): string[] {
  // 1. Strip ALL markdown fence markers (``` or ```json) anywhere in the text.
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const candidates: string[] = [];
  if (cleaned.length > 0) {
    candidates.push(cleaned);
  }

  // 3. Collect EVERY top-level balanced `{ ... }` object in order, scanning with
  //    a depth counter that respects strings and escapes (so nested braces / code
  //    braces in values don't terminate the scan early).
  const objects: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      // Skip this char (opener) — extractBalanced starts at the `{` itself.
      const obj = extractBalanced(cleaned, i, '{', '}');
      if (obj !== undefined) {
        objects.push(obj);
        i += obj.length - 1;
      }
    } else if (ch === '}') {
      // nothing — stray closing brace outside a top-level object; ignore.
    }
  }

  // 2. JSONL runs: a fast model often streams `{...}{...}{...}` (with or without
  //    newlines) instead of a single envelope. Wrapping the top-level objects in
  //    an array (comma-joined) turns that into a valid array of findings.
  if (objects.length >= 2) {
    candidates.push(`[${objects.join(',')}]`);
  }
  for (const obj of objects) {
    candidates.push(obj);
  }

  // 4. First balanced `[ ... ]` array (a model that emitted a bare array).
  const arr = extractBalanced(cleaned, cleaned.indexOf('['), '[', ']');
  if (arr !== undefined) candidates.push(arr);

  return candidates;
}

function extractBalanced(text: string, start: number, open: string, close: string): string | undefined {
  if (start < 0 || start >= text.length) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) depth--;
    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  // Unbalanced — only salvage a truncated root when it plausibly *is* JSON:
  // the text after the bracket must show real JSON structure (a key:value or a
  // nested structure), not just a stray brace in prose like "not json {".
  const root = text.slice(start).trim();
  if (/^[{[]/.test(root) && /[:[{"\d-]/.test(root.slice(1))) {
    return root;
  }
  return undefined;
}

/**
 * Attempt to repair a (possibly truncated) JSON string by closing unterminated
 * strings/objects/arrays and dropping a single trailing comma. Returns the
 * repaired string if it parses, or `undefined` on failure.
 */
function tryRepairTruncatedJson(s: string): string | undefined {
  let repaired = s.trim();
  // A trailing comma before a closing brace/bracket is never valid JSON.
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // Close any unterminated string.
  const quoteCount = repaired.match(/"/g)?.length ?? 0;
  if (quoteCount % 2 !== 0) {
    repaired += '"';
  }
  // Walk the text, tracking the stack of OPENING delimiters seen outside
  // of strings. Appending closers innermost-first (LIFO) yields the correct
  // nesting when an object is cut off while still inside its array.
  const stack: Array<string> = [];
  let inStr = false;
  let esc = false;
  for (const ch of repaired) {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') stack.push('{');
    else if (ch === '[') stack.push('[');
    else if (ch === '}') {
      if (stack[stack.length - 1] === '{') stack.pop();
    } else if (ch === ']') {
      if (stack[stack.length - 1] === '[') stack.pop();
    }
  }
  // Append a closer for every still-open delimiter, innermost-first.
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === '{' ? '}' : ']';
  }
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return undefined;
  }
}

/** Parse the first candidate that yields valid JSON, repairing each on failure.
 * Returns the parsed value plus `wasRepaired: true` when a candidate only
 * parsed after `tryRepairTruncatedJson` — the caller flags the report so the
 * UI can warn instead of presenting repaired findings as ground truth. */
function parseJson(raw: string): { parsed: unknown; wasRepaired: boolean } {
  const candidates = extractCandidates(raw);
  for (const candidate of candidates) {
    try {
      return { parsed: JSON.parse(candidate), wasRepaired: false };
    } catch {
      const repaired = tryRepairTruncatedJson(candidate);
      if (repaired !== undefined) {
        try {
          return { parsed: JSON.parse(repaired), wasRepaired: true };
        } catch {
          // fall through to the next candidate.
        }
      }
    }
  }
  throw new ReviewParseError('AI review output was not valid JSON', new Error(raw.slice(0, 2000)));
}

/** Normalize a parsed value into {@link ReviewAgentOutput}, tolerating the
 *  "bare finding" and "bare finding-array" shapes fast models sometimes emit. */
function toReviewOutput(parsed: unknown): ReviewAgentOutput {
  const obj = (parsed ?? {}) as Record<string, unknown>;

  // If the model wrapped everything under a single key (e.g. { review: {...} }),
  // unwrap it for the shape checks below.
  const inner =
    typeof obj.summary === 'string' ||
    Array.isArray(obj.findings) ||
    Array.isArray(obj.suggestions) ||
    obj.overallVerdict !== undefined
      ? obj
      : ((Object.values(obj).find((v) => v !== null && typeof v === 'object') as Record<string, unknown> | undefined) ??
        obj);

  // Bare array of findings (model returned [{...}] not the envelope).
  if (Array.isArray(parsed)) {
    return {
      summary: '',
      overallVerdict: ReviewVerdict.Comment,
      findings: normalizeFindings(parsed),
      suggestions: [],
    };
  }

  // A single bare finding object (model returned {...} not the envelope).
  if (
    typeof inner.file === 'string' &&
    (typeof inner.message === 'string' || typeof inner.message === 'number') &&
    !Array.isArray(inner.findings)
  ) {
    return {
      summary: '',
      overallVerdict: ReviewVerdict.Comment,
      findings: normalizeFindings([inner]),
      suggestions: [],
    };
  }

  const healthScore = normalizeHealthScore(inner.healthScore);
  const verdict = normalizeVerdict(inner.overallVerdict);
  const findings = normalizeFindings(inner.findings);
  return {
    summary: typeof inner.summary === 'string' ? inner.summary : '',
    overallVerdict: verdict,
    findings,
    suggestions: normalizeSuggestions(inner.suggestions),
    ...(healthScore !== undefined ? { healthScore: cohereRiskToEvidence(healthScore, findings, verdict) } : {}),
  };
}

export function parseReviewOutput(raw: string): ReviewAgentOutput {
  const { parsed, wasRepaired } = parseJson(raw);
  const output = toReviewOutput(parsed);
  return wasRepaired ? { ...output, wasRepaired: true } : output;
}
