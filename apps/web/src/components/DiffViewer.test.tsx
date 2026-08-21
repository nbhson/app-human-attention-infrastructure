// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DiffViewer } from './DiffViewer';
import type { ReviewFileDiff } from '../api/review';

const DIFFS: readonly ReviewFileDiff[] = [
  {
    path: 'src/foo.ts',
    hunks: '@@ -1,3 +1,3 @@\n context\n-removed\n+added',
    addedLines: 1,
    removedLines: 1,
    isNewFile: false,
  },
];

describe('DiffViewer', () => {
  it('renders the file path and hunk lines', () => {
    render(<DiffViewer diffs={DIFFS} />);
    expect(screen.getByText(/src\/foo\.ts/)).toBeInTheDocument();
    expect(screen.getByText('+added')).toBeInTheDocument();
    expect(screen.getByText('-removed')).toBeInTheDocument();
  });

  it('shows a placeholder when there are no diffs', () => {
    render(<DiffViewer diffs={[]} />);
    expect(screen.getByText(/No diff available/)).toBeInTheDocument();
  });
});
