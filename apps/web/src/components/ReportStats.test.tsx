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
  flaggedLines: 25,
  flaggedFiles: 3,
  attentionShare: 0.25,
  findingTotal: 5,
  severity: { CRITICAL: 2, MAJOR: 1, MINOR: 1, NIT: 1, INFO: 0 },
};

describe('ReportStats', () => {
  it('shows the verdict and the attention share as a percentage', () => {
    render(<ReportStats stats={stats} overallVerdict="REQUEST_CHANGES" />);

    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Request changes');
    expect(screen.getByTestId('attention-pct')).toHaveTextContent('25%');
    expect(screen.getByText('25 of 100 changed lines')).toBeInTheDocument();
    expect(screen.getByText('Findings touch 3 of 4 files')).toBeInTheDocument();
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
});
