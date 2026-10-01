// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReviewFinding } from '../api/reviews';
import { buildDimensionExplanation, ScoreHelp } from './ScoreExplanation';

const finding: ReviewFinding = {
  id: 'f1',
  severity: 'MAJOR',
  kind: 'correctness',
  file: 'src/auth/login.ts',
  line: 42,
  message: 'Missing auth check allows bypass.',
  suggestion: 'Add session validation before granting access.',
  orderIndex: 0,
  anchor: { status: 'verified', detail: 'in diff' },
};

describe('buildDimensionExplanation', () => {
  it('links security findings to the security dimension', () => {
    const exp = buildDimensionExplanation('security', 62, [finding], undefined);
    expect(exp.reasons.length).toBeGreaterThan(0);
    expect(exp.suggestions[0].findingId).toBe('f1');
  });

  it('falls back to generic suggestions when nothing correlates', () => {
    const exp = buildDimensionExplanation('performance', 80, [], undefined);
    expect(exp.reasons.length).toBeGreaterThan(0);
    expect(exp.suggestions.length).toBeGreaterThan(0);
    expect(exp.suggestions[0].findingId).toContain('generic');
  });
});

describe('ScoreHelp', () => {
  it('hides the ? trigger on a perfect score', () => {
    render(<ScoreHelp dimension="security" label="Security" score={100} findings={[finding]} />);
    expect(screen.queryByRole('button', { name: /why security/i })).not.toBeInTheDocument();
  });

  it('opens a popover with reasons and suggestions on click', () => {
    render(<ScoreHelp dimension="security" label="Security" score={62} findings={[finding]} />);
    const trigger = screen.getByRole('button', { name: /why security is 62\/100/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: /why security scored 62/i })).toBeInTheDocument();
    expect(screen.getByText(/reasons/i)).toBeInTheDocument();
    expect(screen.getByText(/how to gain points/i)).toBeInTheDocument();
    expect(screen.getByText(/missing auth check/i)).toBeInTheDocument();
  });
});
