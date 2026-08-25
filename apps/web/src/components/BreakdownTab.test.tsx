// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReviewStats } from '../api/reviews';
import { BreakdownTab } from './BreakdownTab';

const stats: ReviewStats = {
  totalFiles: 4,
  addedLines: 1232,
  removedLines: 0,
  changedLines: 1232,
  flaggedAddedLines: 1148,
  flaggedFiles: 2,
  attentionShare: 0.5,
  findingTotal: 4,
  severity: { CRITICAL: 1, MAJOR: 1, MINOR: 1, NIT: 1, INFO: 0 },
  composition: [
    { category: 'source', files: 1, additions: 605, deletions: 0 },
    { category: 'test', files: 1, additions: 543, deletions: 0 },
    { category: 'style', files: 1, additions: 75, deletions: 0 },
    { category: 'markup', files: 1, additions: 9, deletions: 0 },
  ],
  excluded: { files: 2, additions: 9140, deletions: 0 },
  flaggedFilesList: [
    { file: 'src/toeic.service.spec.ts', severities: ['CRITICAL'] },
    { file: 'src/toeic.service.ts', severities: ['MAJOR', 'MINOR'] },
  ],
};

describe('BreakdownTab', () => {
  it('explains the attention share and names the flagged files', () => {
    render(<BreakdownTab stats={stats} />);

    expect(screen.getByTestId('breakdown-tab')).toBeInTheDocument();
    expect(screen.getByText('Why 50%?')).toBeInTheDocument();
    expect(screen.getByTestId('attention-files')).toHaveTextContent('2 of 4 source files');
    expect(screen.getByTestId('flagged-files')).toHaveTextContent('src/toeic.service.ts');
  });

  it('shows the diff composition, the excluded lines, and the signal/noise split', () => {
    render(<BreakdownTab stats={stats} />);

    expect(screen.getByTestId('composition')).toHaveTextContent('Test specs');
    expect(screen.getByText(/sit outside the attention metric/)).toBeInTheDocument();
    expect(screen.getByTestId('signal-count')).toHaveTextContent('3'); // CRITICAL + MAJOR + MINOR
    expect(screen.getByTestId('noise-count')).toHaveTextContent('1'); // NIT + INFO
  });

  it('degrades to a notice instead of crashing when stats are absent', () => {
    render(<BreakdownTab stats={undefined} />);

    expect(screen.getByTestId('breakdown-tab-empty')).toBeInTheDocument();
    expect(screen.getByText('Statistics are unavailable for this report.')).toBeInTheDocument();
  });
});
