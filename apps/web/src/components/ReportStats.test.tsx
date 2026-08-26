// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReviewStats } from '../api/reviews';
import { ReportStats } from './ReportStats';

const stats: ReviewStats = {
  totalFiles: 4,
  addedLines: 80,
  removedLines: 20,
  changedLines: 100,
  flaggedAddedLines: 20,
  flaggedFiles: 3,
  attentionShare: 0.75,
  findingTotal: 5,
  severity: { CRITICAL: 2, MAJOR: 1, MINOR: 1, NIT: 1, INFO: 0 },
  composition: [
    { category: 'source', files: 3, additions: 60, deletions: 15 },
    { category: 'test', files: 1, additions: 20, deletions: 5 },
  ],
  excluded: { files: 1, additions: 9000, deletions: 0, filesList: [] },
  flaggedFilesList: [
    { file: 'src/a.ts', severities: ['CRITICAL', 'MAJOR'] },
    { file: 'src/b.ts', severities: ['MINOR'] },
    { file: 'src/c.ts', severities: ['CRITICAL'] },
  ],
  cleanup: { files: 0, findings: 0, filesList: [] },
};

describe('ReportStats', () => {
  it('shows the verdict and the attention share as a percentage over source files', () => {
    render(<ReportStats stats={stats} overallVerdict="REQUEST_CHANGES" />);

    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Request changes');
    expect(screen.getByTestId('attention-pct')).toHaveTextContent('75%');
    expect(screen.getByText('3 of 4 source files')).toBeInTheDocument();
    expect(screen.getByText(/NIT and INFO don't count/)).toBeInTheDocument();
  });

  it('labels every severity band with its count and share of total findings', () => {
    render(<ReportStats stats={stats} overallVerdict="APPROVE" />);

    expect(screen.getByTestId('severity-CRITICAL')).toHaveTextContent('2 (40%)');
    expect(screen.getByTestId('severity-MAJOR')).toHaveTextContent('1 (20%)');
    expect(screen.getByTestId('severity-INFO')).toHaveTextContent('0 (0%)');
  });

  it('renders a stacked segment only for non-zero bands', () => {
    render(<ReportStats stats={stats} overallVerdict="COMMENT" />);

    expect(screen.getByTestId('severity-segment-CRITICAL')).toBeInTheDocument();
    expect(screen.queryByTestId('severity-segment-INFO')).not.toBeInTheDocument();
  });

  it('degrades to a notice instead of crashing when stats are absent', () => {
    render(<ReportStats stats={undefined} overallVerdict="COMMENT" />);

    expect(screen.getByTestId('report-stats')).toBeInTheDocument();
    expect(screen.getByText('Statistics are unavailable for this report.')).toBeInTheDocument();
    expect(screen.queryByTestId('verdict-badge')).not.toBeInTheDocument();
  });
});
