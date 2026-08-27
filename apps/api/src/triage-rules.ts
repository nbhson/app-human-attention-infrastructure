/**
 * Review-slice triage derivation (review-reorient Phase 3) — the pure, total,
 * never-throws rules that turn a report's stored findings + PR paths + shadow-
 * judge scores into a small `triage` block the UI can render. No I/O: the
 * rule-state booleans are passed in, so this file is the same family as
 * `pr-files.ts` / `list-summary.ts` and is unit-tested in isolation.
 *
 * Honesty constraints, kept explicit here on purpose:
 *  - Rule 1 (security-block) only ever *downgrades* the effective
 *    recommendation; it never rewrites the AI's own verdict, which the caller
 *    keeps in a separate field.
 *  - Rule 2 (performance regression) is a **heuristic risk flag**, not a
 *    fabricated "regression detected": it fires only when a MAJOR+ finding sits
 *    in production *source* code AND a shadow-judge run actually exists with a
 *    low `overall` score. No judge run → nothing asserted.
 *  - Rule 3 (schema/data integrity) is a visibility flag over the PR's touched
 *    files; it never invents a data-shape change.
 */

import { classifySourceFile } from './review-file-classify.js';

/** The three wired rule toggles (see the `triage_rules` singleton row). */
export interface TriageRuleStateInput {
  readonly securityBlock: boolean;
  readonly performanceRegression: boolean;
  readonly schemaIntegrity: boolean;
}

/** A minimal finding: just what triage needs (severity + file path). */
export interface TriageFinding {
  readonly severity: string;
  readonly file: string;
}

/** A minimal shadow-judge run: the single score triage reads (`overall`, 0..1). */
export interface TriageJudgeRun {
  readonly overall?: unknown;
}

/** Short ids for the rules that actually fired (mapped to labels in the UI). */
export type TriageRuleId = 'security-block' | 'performance-regression' | 'schema-integrity';

/** The derived triage block, ready to attach to a list row or report. */
export interface TriageResult {
  readonly securityBlocked: boolean;
  readonly regressionRisk: boolean;
  readonly schemaGate: boolean;
  readonly matchedRules: readonly TriageRuleId[];
  /**
   * `'REQUEST_CHANGES'` when rule 1 downgrades the recommendation, else `null`
   * (the caller substitutes the report's raw `overall_verdict`).
   */
  readonly effectiveVerdict: 'REQUEST_CHANGES' | null;
}

/** Auth/secrets/credential *path segments* handled by the security-block rule. */
const SECURITY_SEGMENTS = new Set([
  'auth',
  'login',
  'logout',
  'session',
  'permission',
  'permissions',
  'rbac',
  'token',
  'tokens',
  'credential',
  'credentials',
  'password',
  'passwd',
  'secret',
  'secrets',
  'apikey',
  'api_key',
  'jwt',
  'oauth',
  'sso',
  'saml',
]);

/** Secret/material file basenames the security rule also flags regardless of path. */
const SECRET_FILE_PATTERNS = [/\.env(\.[a-z0-9]+)?$/i, /\.pem$/i, /\.key$/i, /\.crt$/i, /^id_rsa/i];

/** Path markers for migrations / schema / data-shape changes (the schema rule). */
const MIGRATION_PATH_PATTERNS = [
  /(^|\/)migrations?(\/|$)/i,
  /alembic/i,
  /flyway/i,
  /drizzle/i,
  /(^|\/)schema\.([a-z0-9]+)$/i,
  /\.sql$/i,
];

/** True when a raw path looks like an auth/secrets/credential location. */
export function isSecurityPath(path: string): boolean {
  if (!path) {
    return false;
  }
  // A known keyword must be a whole path segment — `tokenizer.ts` is not `token`.
  const segments = path.split(/[^a-zA-Z0-9]+/).map((part) => part.toLowerCase());
  if (segments.some((segment) => SECURITY_SEGMENTS.has(segment))) {
    return true;
  }
  const basename = path.split('/').pop() ?? '';
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(basename));
}

/** True when a raw path looks like a migration/schema/data-shape change. */
export function isMigrationPath(path: string): boolean {
  if (!path) {
    return false;
  }
  return MIGRATION_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function isMajorOrCritical(severity: string): boolean {
  return severity === 'CRITICAL' || severity === 'MAJOR';
}

/** Regression-risk threshold on the shadow judge's `overall` score (0..1). */
const REGRESSION_OVERALL_THRESHOLD = 0.5;

/**
 * Derive the `triage` block. `judgeRuns` may be empty (e.g. the list endpoint,
 * which does not load judge rows) — in that case rule 2 contributes nothing,
 * because a regression *risk* claim requires an actual judge signal.
 */
export function computeTriage(input: {
  readonly rules: TriageRuleStateInput;
  readonly findings?: readonly TriageFinding[];
  readonly prFilePaths?: readonly string[];
  readonly judgeRuns?: readonly TriageJudgeRun[];
}): TriageResult {
  const { rules } = input;
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const prFilePaths = Array.isArray(input.prFilePaths) ? input.prFilePaths : [];
  const judgeRuns = Array.isArray(input.judgeRuns) ? input.judgeRuns : [];

  const securityBlocked =
    rules.securityBlock &&
    findings.some((finding) => finding.severity === 'CRITICAL' && isSecurityPath(finding.file));

  const schemaGate = rules.schemaIntegrity && prFilePaths.some(isMigrationPath);

  const lowOverallJudge = judgeRuns.some((run) => {
    const overall = typeof run.overall === 'number' ? run.overall : NaN;
    return Number.isFinite(overall) && overall < REGRESSION_OVERALL_THRESHOLD;
  });
  const regressionRisk =
    rules.performanceRegression &&
    lowOverallJudge &&
    findings.some(
      (finding) =>
        isMajorOrCritical(finding.severity) && classifySourceFile(finding.file) === 'source',
    );

  const matchedRules: TriageRuleId[] = [];
  if (securityBlocked) matchedRules.push('security-block');
  if (regressionRisk) matchedRules.push('performance-regression');
  if (schemaGate) matchedRules.push('schema-integrity');

  return {
    securityBlocked,
    regressionRisk,
    schemaGate,
    matchedRules,
    effectiveVerdict: securityBlocked ? 'REQUEST_CHANGES' : null,
  };
}
