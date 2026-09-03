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

/** Parse the first candidate that yields valid JSON, repairing each on failure. */
function parseJson(raw: string): unknown {
  const candidates = extractCandidates(raw);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      const repaired = tryRepairTruncatedJson(candidate);
      if (repaired !== undefined) {
        try {
          return JSON.parse(repaired);
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

  return {
    summary: typeof inner.summary === 'string' ? inner.summary : '',
    overallVerdict: normalizeVerdict(inner.overallVerdict),
    findings: normalizeFindings(inner.findings),
    suggestions: normalizeSuggestions(inner.suggestions),
  };
}

export function parseReviewOutput(raw: string): ReviewAgentOutput {
  const parsed = parseJson(raw);
  return toReviewOutput(parsed);
}
