/**
 * Canonical report hashing (day-22 §2.2) — the reproducibility anchor.
 *
 * Every judge run stamps the report it judged with a SHA-256 of the *judged
 * artifact* — the recommended verdict, the summary, and the findings (severity,
 * file, line, message, suggestion). Two runs over the same judged content always
 * share a hash, and two runs over different content never collide, so any
 * agreement figure can be recomputed from the audit rows: load the runs by id,
 * re-hash their report, recompute the scores, and compare.
 */

import { createHash } from 'node:crypto';

import { ReviewSeverity } from '@harness/domain';
import type {
  ReviewFinding,
  ReviewReport,
  ReviewSeverity as ReviewSeverityType,
} from '@harness/domain';

/** Severity band → sort rank (highest first). Unknown bands sort last. */
const SEVERITY_RANK: Record<ReviewSeverityType, number> = {
  [ReviewSeverity.Critical]: 4,
  [ReviewSeverity.Major]: 3,
  [ReviewSeverity.Minor]: 2,
  [ReviewSeverity.Nit]: 1,
  [ReviewSeverity.Info]: 0,
};

/** A locale-independent `<` comparison for canonical string ordering. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Render one finding to its canonical (deterministic, key-ordered) form. */
function canonicalFinding(finding: ReviewFinding): Record<string, unknown> {
  return {
    severity: finding.severity,
    file: finding.file,
    line: finding.line ?? null,
    message: finding.message,
    suggestion: finding.suggestion ?? null,
  };
}

/**
 * SHA-256 (hex) of the judged artifact, independent of store metadata.
 *
 * Does **not** include the report id, `createdAt`, PR title/URL, provider, or
 * model — those are provenance of the *production* of the report, not of the
 * content the judge grades. The judged content is the verdict + summary +
 * findings, which is exactly what `buildRubricPrompt` renders.
 */
export function canonicalReportHash(report: ReviewReport): string {
  const findings = [...report.findings]
    .sort((a, b) => {
      const severity = (SEVERITY_RANK[b.severity] ?? -1) - (SEVERITY_RANK[a.severity] ?? -1);
      if (severity !== 0) {
        return severity;
      }
      const file = compare(a.file, b.file);
      if (file !== 0) {
        return file;
      }
      return (a.line ?? 0) - (b.line ?? 0);
    })
    .map(canonicalFinding);

  const canonical = {
    verdict: report.overallVerdict,
    summary: report.summary,
    findings,
  };

  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}
