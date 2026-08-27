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
  languages: [{ language: 'TypeScript', files: 4, additions: 1232, deletions: 0, share: 1 }],
  excluded: {
    files: 1,
    additions: 8776,
    deletions: 0,
    filesList: [{ path: 'package-lock.json', additions: 8776, deletions: 0 }],
  },
  flaggedFilesList: [
    { file: 'src/toeic.service.spec.ts', severities: ['CRITICAL'] },
    { file: 'src/toeic.service.ts', severities: ['MAJOR', 'MINOR'] },
  ],
  cleanup: {
    files: 2,
    findings: 3,
    filesList: [
      { file: 'src/dead.ts', count: 2 },
      { file: 'src/dup.ts', count: 1 },
    ],
  },
};

describe('BreakdownTab', () => {
  it('explains the attention share and names the flagged files', () => {
    render(<BreakdownTab stats={stats} />);

    expect(screen.getByTestId('breakdown-tab')).toBeInTheDocument();
    expect(screen.getByText('Why 50%?')).toBeInTheDocument();
    expect(screen.getByTestId('attention-files')).toHaveTextContent('2 of 4 files');
    expect(screen.getByTestId('flagged-files')).toHaveTextContent('src/toeic.service.ts');
  });

  it('shows the diff composition, the excluded lines, and the signal/noise split', () => {
    render(<BreakdownTab stats={stats} />);

    expect(screen.getByTestId('composition')).toHaveTextContent('Test specs');
    expect(screen.getByText(/sit outside the attention metric/)).toBeInTheDocument();
    expect(screen.getByTestId('signal-count')).toHaveTextContent('3'); // CRITICAL + MAJOR + MINOR
    expect(screen.getByTestId('noise-count')).toHaveTextContent('1'); // NIT + INFO
  });

  it('names every excluded (generated) file so the denominator is provable, not just counted', () => {
    render(<BreakdownTab stats={stats} />);

    const excluded = screen.getByTestId('excluded-files');
    expect(excluded).toHaveTextContent('package-lock.json');
    expect(excluded).toHaveTextContent('Generated');
  });

  it('lists cleanup opportunities (dead code) separately from the attention share', () => {
    render(<BreakdownTab stats={stats} />);

    expect(screen.getByTestId('cleanup-files')).toHaveTextContent('2');
    expect(screen.getByTestId('cleanup-findings')).toHaveTextContent('3');
    expect(screen.getByTestId('cleanup-files-list')).toHaveTextContent('src/dead.ts');
    expect(screen.getByTestId('cleanup-files-list')).toHaveTextContent('2 findings');
  });

  it('degrades to a notice instead of crashing when stats are absent', () => {
    render(<BreakdownTab stats={undefined} />);

    expect(screen.getByTestId('breakdown-tab-empty')).toBeInTheDocument();
    expect(screen.getByText('Statistics are unavailable for this report.')).toBeInTheDocument();
  });
});
