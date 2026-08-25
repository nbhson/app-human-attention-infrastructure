import type { ReviewFinding } from '../api/reviews';

/**
 * Severity display vocabulary (review-reorient Phase 3) — one place that maps the
 * AI's severity bands onto order, colour, and a human label, so the report page
 * and the report dashboard agree. Colours are theme tokens, not raw hex, so they
 * follow dark mode automatically.
 */

/** Severity bands, highest first. Mirrors `ReviewSeverity` from `@harness/domain`. */
export const SEVERITIES = ['CRITICAL', 'MAJOR', 'MINOR', 'NIT', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Fixed ranking for sorting band → position at a glance (lower = worse). */
const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  MAJOR: 1,
  MINOR: 2,
  NIT: 3,
  INFO: 4,
};

/** Colour token per band (status palette — reserved, never reused as "series N"). */
const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: 'var(--sev-critical)',
  MAJOR: 'var(--sev-major)',
  MINOR: 'var(--sev-minor)',
  NIT: 'var(--sev-nit)',
  INFO: 'var(--sev-info)',
};

/** Human-readable band label. */
const SEVERITY_LABEL: Record<Severity, string> = {
  CRITICAL: 'Critical',
  MAJOR: 'Major',
  MINOR: 'Minor',
  NIT: 'Nit',
  INFO: 'Info',
};

export function severityRank(severity: string): number {
  return (SEVERITY_RANK as Record<string, number>)[severity] ?? 999;
}

export function severityColor(severity: string): string {
  return (SEVERITY_COLOR as Record<string, string>)[severity] ?? 'var(--color-text-faint)';
}

export function severityLabel(severity: string): string {
  return (SEVERITY_LABEL as Record<string, string>)[severity] ?? severity;
}

/** Sort a report's findings worst-first, ties broken by the AI's original order. */
export function sortFindingsBySeverity(
  findings: readonly ReviewFinding[],
): readonly ReviewFinding[] {
  return [...findings].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.orderIndex - b.orderIndex,
  );
}
