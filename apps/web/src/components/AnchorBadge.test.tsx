// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { FindingAnchor } from '../api/reviews';
import { AnchorBadge } from './AnchorBadge';

const verified: FindingAnchor = { status: 'verified', detail: 'line 10 is in this diff' };
const unverified: FindingAnchor = { status: 'unverified', detail: 'file not touched by this PR' };

describe('AnchorBadge', () => {
  it('labels a verified anchor with a check', () => {
    render(<AnchorBadge anchor={verified} />);
    expect(screen.getByTestId('anchor-verified')).toHaveTextContent('verified');
  });

  it('labels an unverified anchor with a warning', () => {
    render(<AnchorBadge anchor={unverified} />);
    expect(screen.getByTestId('anchor-unverified')).toHaveTextContent('unverified');
  });

  it('exposes the reason as a tooltip for both verdicts', () => {
    const { rerender } = render(<AnchorBadge anchor={verified} />);
    expect(screen.getByTestId('anchor-verified')).toHaveAttribute(
      'title',
      'line 10 is in this diff',
    );

    rerender(<AnchorBadge anchor={unverified} />);
    expect(screen.getByTestId('anchor-unverified')).toHaveAttribute(
      'title',
      'file not touched by this PR',
    );
  });
});
