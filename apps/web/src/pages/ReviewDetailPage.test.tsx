// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewApi, type QueueItemDetail } from '../api/review';
import ReviewDetailPage from './ReviewDetailPage';

vi.mock('../api/review', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/review')>();
  return {
    ...actual,
    reviewApi: {
      ...actual.reviewApi,
      getDetail: vi.fn(),
      getEvidence: vi.fn(),
      claim: vi.fn(),
      decide: vi.fn(),
    },
  };
});

const mocked = vi.mocked(reviewApi);

const DETAIL: QueueItemDetail = {
  id: 'q-1',
  taskId: 'task-1',
  assessmentId: 'asmt-1',
  changeId: 'change-1',
  action: 'REVIEW',
  position: 1,
  status: 'CLAIMED',
  claimedBy: 'reviewer-1',
  claimedAt: '2026-08-22T00:00:00.000Z',
  createdAt: '2026-08-22T00:00:00.000Z',
  label: 'HIGH',
  combinedPriority: 0.74,
  ruleId: 'r2-high',
  policyVersion: 1,
  taskTitle: 'Fix payment retry loop',
  taskState: 'AWAITING_REVIEW',
  factors: [
    { key: 'risk', score: 0.6, available: true },
    { key: 'impact', score: 0.8, available: true },
    { key: 'novelty', score: 0.3, available: true },
    { key: 'complexity', score: 0.4, available: true },
    { key: 'confidence', score: 0.5, available: false },
  ],
  checks: [
    { kind: 'COMPILE', status: 'PASSED', evidenceId: 'evt-1' },
    { kind: 'TEST', status: 'FLAKY', evidenceId: 'evt-2' },
  ],
  diffs: [
    { path: 'src/foo.ts', hunks: '+added', addedLines: 1, removedLines: 0, isNewFile: false },
  ],
  decision: null,
};

function renderDetail(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/review/q-1']}
      >
        <Routes>
          <Route path="/review/:id" element={<ReviewDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReviewDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getDetail.mockResolvedValue(DETAIL);
  });

  it('shows the "why" panel: label, rule_id, policy_version, and five factors', async () => {
    renderDetail();

    expect(await screen.findByText(/Fix payment retry loop/)).toBeInTheDocument();
    expect(screen.getByText(/r2-high/)).toBeInTheDocument();
    expect(screen.getByText(/policy v1/)).toBeInTheDocument();
    expect(screen.getByTestId('factor-confidence')).toHaveTextContent('unavailable');
    expect(screen.getByTestId('factor-risk')).toHaveTextContent('0.60');
  });

  it('submits the decision only once decision + rationale + wasUseful are filled', async () => {
    mocked.decide.mockResolvedValue({ ...DETAIL, status: 'DECIDED' });
    renderDetail();

    await screen.findByText(/Fix payment retry loop/);
    const submit = screen.getByRole('button', { name: /^Submit$/ });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /approve/i }));
    fireEvent.change(screen.getByLabelText(/rationale/i), { target: { value: 'looks good' } });
    fireEvent.click(screen.getByRole('radio', { name: /^yes$/i }));
    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    await waitFor(() => expect(mocked.decide).toHaveBeenCalled());
    expect(mocked.decide).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({ decision: 'APPROVE', rationale: 'looks good', wasUseful: true }),
    );
  });

  it('opens the evidence modal from a verification badge', async () => {
    mocked.getEvidence.mockResolvedValue({ id: 'evt-1', kind: 'COMPILE', body: 'BUILD OK' });
    renderDetail();

    const evidenceButtons = await screen.findAllByRole('button', { name: /evidence/i });
    fireEvent.click(evidenceButtons[0] as HTMLElement);

    expect(await screen.findByTestId('evidence-body')).toHaveTextContent('BUILD OK');
    expect(mocked.getEvidence).toHaveBeenCalledWith('evt-1');
  });
});
