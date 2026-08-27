// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReviewStats } from '../api/reviews';
import { SummaryMetricsPanel } from './SummaryMetricsPanel';

function statsWith(languages: ReviewStats['languages']): ReviewStats {
  return {
    totalFiles: 5,
    addedLines: 100,
    removedLines: 10,
    changedLines: 110,
    flaggedAddedLines: 20,
    flaggedFiles: 2,
    attentionShare: 0.4,
    findingTotal: 3,
    severity: { CRITICAL: 0, MAJOR: 1, MINOR: 2, NIT: 0, INFO: 0 },
    composition: [{ category: 'source', files: 5, additions: 100, deletions: 10 }],
    languages,
    excluded: { files: 0, additions: 0, deletions: 0, filesList: [] },
    flaggedFilesList: [{ file: 'src/a.ts', severities: ['MAJOR'] }],
    cleanup: { files: 0, findings: 0, filesList: [] },
  };
}

describe('SummaryMetricsPanel languages', () => {
  it('shows the severity donut with a total and per-band legend counts', () => {
    render(<SummaryMetricsPanel summary="summary" stats={statsWith([])} findings={[]} />);

    expect(screen.getByTestId('severity-donut')).toBeInTheDocument();
    // findingTotal = 3 (MAJOR 1 + MINOR 2) is centred inside the donut.
    expect(screen.getByTestId('donut-center')).toHaveTextContent('3');
    expect(screen.getByTestId('severity-MAJOR')).toHaveTextContent('1');
    expect(screen.getByTestId('severity-MAJOR')).toHaveTextContent('33%');
    expect(screen.getByTestId('severity-MINOR')).toHaveTextContent('2');
    expect(screen.getByTestId('severity-MINOR')).toHaveTextContent('67%');
    // Zero-count bands stay listed but dimmed.
    expect(screen.getByTestId('severity-CRITICAL')).toHaveTextContent('0');
  });

  it('shows a GitHub-style language breakdown weighted by changed lines', () => {
    render(
      <SummaryMetricsPanel
        summary="summary"
        stats={statsWith([
          { language: 'TypeScript', files: 3, additions: 50, deletions: 1, share: 0.464 },
          { language: 'JavaScript', files: 1, additions: 21, deletions: 0, share: 0.19 },
          { language: 'SCSS', files: 1, additions: 18, deletions: 0, share: 0.164 },
        ])}
        findings={[]}
      />,
    );

    expect(screen.getByText('Languages')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('46.4%')).toBeInTheDocument();
    expect(screen.getByText('JavaScript')).toBeInTheDocument();
    expect(screen.getByText('19.0%')).toBeInTheDocument();
    expect(screen.getByText('SCSS')).toBeInTheDocument();
    expect(screen.getByText('16.4%')).toBeInTheDocument();
  });

  it('renders the backend-provided Other rather than guessing a language', () => {
    render(
      <SummaryMetricsPanel
        summary="summary"
        stats={statsWith([{ language: 'Other', files: 1, additions: 1, deletions: 0, share: 1 }])}
        findings={[]}
      />,
    );

    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getByText('100.0%')).toBeInTheDocument();
  });

  it('shows a neutral note when there is no language breakdown', () => {
    render(<SummaryMetricsPanel summary="summary" stats={statsWith([])} findings={[]} />);

    expect(screen.getByText('No changed files to break down by language.')).toBeInTheDocument();
  });

  it('toggles between the severity donut and the Issue Counts bars', () => {
    render(<SummaryMetricsPanel summary="summary" stats={statsWith([])} findings={[]} />);

    // Defaults to the donut.
    expect(screen.getByTestId('severity-donut')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Issue Counts/ }));

    expect(screen.getByRole('img', { name: 'Findings by severity bar chart' })).toBeInTheDocument();
    expect(screen.queryByTestId('severity-donut')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Severity Donut/ }));
    expect(screen.getByTestId('severity-donut')).toBeInTheDocument();
  });
});
