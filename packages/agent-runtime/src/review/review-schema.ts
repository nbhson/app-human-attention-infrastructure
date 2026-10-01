/**
 * JSON Schemas for the reviewer's structured output — the machine-readable twin
 * of the review contract written out in prose in `review-prompt.ts` (reviewer-v9
 * keeps the reviewer-v8 output contract unchanged; v9 only adds input context).
 *
 * The prompt asks for the right shape; these schemas *enforce* it. Prompt-only
 * compliance is not enough on a local model: asked for the `reviewer-v6`
 * envelope, `gemma4:e2b` returned a bare findings array plus a prose
 * `**Verdict: REQUEST_CHANGES**` line. `parseReviewOutput` still recovered the
 * findings, but `summary`/`healthScore` came back empty and the missing
 * `overallVerdict` degraded to `COMMENT` — silently storing a PR the model
 * wanted to block as non-blocking.
 *
 * Because the prompt and these schemas must not drift, changing either the
 * output contract or the prompt's OUTPUT FORMAT section means updating
 * {@link REVIEW_OUTPUT_SCHEMA} and {@link FILE_SUMMARY_SCHEMA} in the same
 * change and bumping `REVIEW_PROMPT_VERSION`.
 */

import { FindingKind, ReviewSeverity, ReviewVerdict } from '@harness/domain';

/** `excellent | good | fair | poor` — see review-prompt.ts HEALTH SCORE §1. */
const RATING = {
  type: 'string',
  enum: ['excellent', 'good', 'fair', 'poor'],
} as const;

/** A fine-grained 1–100 score; see review-prompt.ts HEALTH SCORE preamble. */
const SCORE = { type: 'integer', minimum: 1, maximum: 100 } as const;

const OVERALL_RISK = {
  type: 'string',
  enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
} as const;

/** The five health dimensions, each emitting a rating plus a `*Score` sibling. */
const HEALTH_DIMENSIONS = ['architecture', 'codeQuality', 'security', 'performance', 'testing'] as const;

const HEALTH_SCORE_PROPERTIES = {
  ...Object.fromEntries(HEALTH_DIMENSIONS.map((k) => [k, RATING])),
  overallRisk: OVERALL_RISK,
  ...Object.fromEntries(HEALTH_DIMENSIONS.map((k) => [`${k}Score`, SCORE])),
  overallRiskScore: SCORE,
} as Record<string, unknown>;

const HEALTH_SCORE_REQUIRED = [
  ...HEALTH_DIMENSIONS,
  'overallRisk',
  ...HEALTH_DIMENSIONS.map((k) => `${k}Score`),
  'overallRiskScore',
];

/**
 * Closed value sets mirrored from `@harness/domain`. Both the schema below and
 * {@link assertSchemaEnumsMatchDomain} read these — a new domain enum value
 * lands here first, so the schema and the guard can never disagree with each
 * other, only (loudly) with the domain.
 */
const OVERALL_VERDICT_VALUES = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const;
const SEVERITY_VALUES = ['CRITICAL', 'MAJOR', 'MINOR', 'NIT', 'INFO'] as const;
const KIND_VALUES = ['correctness', 'cleanup'] as const;

/**
 * The `ReviewAgentOutput` envelope. `wasRepaired` is deliberately absent — it is
 * the *parser's* annotation, not something the model may claim.
 */
export const REVIEW_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    overallVerdict: { type: 'string', enum: [...OVERALL_VERDICT_VALUES] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: [...SEVERITY_VALUES] },
          kind: { type: 'string', enum: [...KIND_VALUES] },
          file: { type: 'string' },
          line: { type: 'integer' },
          message: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['severity', 'kind', 'file', 'message'],
      },
    },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          hunk: { type: 'string' },
          proposed: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['file', 'proposed', 'rationale'],
      },
    },
    healthScore: {
      type: 'object',
      properties: HEALTH_SCORE_PROPERTIES,
      required: HEALTH_SCORE_REQUIRED,
    },
  },
  required: ['summary', 'overallVerdict', 'findings', 'suggestions', 'healthScore'],
};

/**
 * The two-pass triage pass returns a **bare array** of {@link FileSummary}, not an
 * envelope — Ollama's `json_schema` mode accepts a top-level array, which is why
 * this one is not wrapped in an object.
 */
export const FILE_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      file: { type: 'string' },
      risk: { type: 'string', enum: ['high', 'medium', 'low'] },
      summary: { type: 'string' },
    },
    required: ['file', 'risk', 'summary'],
  },
};

/**
 * Drift guard: a `FindingKind` / `ReviewSeverity` / `ReviewVerdict` addition that
 * does not also land in {@link REVIEW_OUTPUT_SCHEMA} would let a model emit a
 * value the grammar accepts but the DB CHECK rejects — the worst kind of
 * mismatch, because it looks like data corruption at write time rather than a
 * config error. Checked at import, but only outside production so a forgotten
 * schema edit cannot crash a running deploy; it stays a hard failure in dev,
 * test, and CI where the mistake is cheap to fix.
 */
function assertSchemaEnumsMatchDomain(): void {
  const checks: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
    ['overallVerdict', OVERALL_VERDICT_VALUES, Object.values(ReviewVerdict)],
    ['findings.severity', SEVERITY_VALUES, Object.values(ReviewSeverity)],
    ['findings.kind', KIND_VALUES, Object.values(FindingKind)],
  ];
  for (const [label, inSchema, inDomain] of checks) {
    const missing = inDomain.filter((v) => !inSchema.includes(v));
    const extra = inSchema.filter((v) => !inDomain.includes(v));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `REVIEW_OUTPUT_SCHEMA drifted from @harness/domain at "${label}": ` +
          `schema is missing [${missing.join(', ')}] and has extra [${extra.join(', ')}]. ` +
          `Update review-schema.ts alongside the domain enum and bump REVIEW_PROMPT_VERSION.`,
      );
    }
  }
}

if (process.env.NODE_ENV !== 'production') {
  assertSchemaEnumsMatchDomain();
}
