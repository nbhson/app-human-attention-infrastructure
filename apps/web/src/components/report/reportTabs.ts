import type { ReviewReport } from '../../api/reviews';

export type ReviewTabKey = 'review' | 'detail' | 'verification' | 'diff' | 'breakdown' | 'trace';

export const TABS: readonly { key: ReviewTabKey; label: string }[] = [
  { key: 'review', label: 'Review' },
  { key: 'detail', label: 'Detail' },
  { key: 'verification', label: 'Verification (sandbox)' },
  { key: 'diff', label: 'Diff' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'trace', label: 'AI trace' },
];

export function tabTitle(report: ReviewReport, tab: ReviewTabKey): string | undefined {
  if (tab === 'trace') {
    const memoryCount = report.recalledMemories?.length ?? 0;
    return memoryCount > 0 ? `${report.trace.calls.length} model calls + ${memoryCount} recalled memories` : undefined;
  }
  return undefined;
}

export function tabBadge(report: ReviewReport, tab: ReviewTabKey): string | number | undefined {
  switch (tab) {
    case 'review':
      return report.findings.length;
    case 'diff':
      return report.diff.length;
    case 'trace':
      return report.trace.calls.length;
    case 'verification': {
      const v = report.verification;
      if (v === null || v === undefined) {
        return undefined;
      }
      if (v.status === 'PASSED') {
        return '✓';
      }
      if (v.status === 'FAILED' || v.status === 'ERROR') {
        return '✕';
      }
      return '·';
    }
    case 'detail':
      return report.healthScore?.overallRisk;
    default:
      return undefined;
  }
}
