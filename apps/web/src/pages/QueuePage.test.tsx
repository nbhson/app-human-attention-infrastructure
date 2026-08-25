// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewApiError, reviewApi, type QueueListItem } from '../api/review';
import QueuePage from './QueuePage';

vi.mock('../api/review', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/review')>();
  return { ...actual, reviewApi: { ...actual.reviewApi, listQueue: vi.fn(), claim: vi.fn() } };
});

const mocked = vi.mocked(reviewApi);

function renderQueue(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <QueuePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function item(
  id: string,
  position: number,
  label: string,
  score: number,
  flaky: boolean,
): QueueListItem {
  return {
    id,
    taskId: `task-${id}`,
    assessmentId: `asmt-${id}`,
    changeId: `change-${id}`,
    action: 'REVIEW',
    position,
    status: 'QUEUED',
    claimedBy: null,
    claimedAt: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    label,
    combinedPriority: score,
    taskTitle: `Task ${id}`,
    flaky,
    ruleId: 'r2-high',
    policyVersion: 1,
  };
}

describe('QueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders rows sorted by position, with label, score, and flaky marker', async () => {
    mocked.listQueue.mockResolvedValue([
      item('q2', 2, 'HIGH', 0.74, false),
      item('q1', 1, 'CRITICAL', 0.91, true),
    ]);

    renderQueue();

    expect(await screen.findByText(/Review Queue \(2\)/)).toBeInTheDocument();
    const q1 = screen.getByTestId('queue-item-q1');
    const q2 = screen.getByTestId('queue-item-q2');
    expect(q1).toHaveTextContent('CRITICAL');
    expect(q1).toHaveTextContent('0.91');
    expect(q1).toHaveTextContent('flaky');
    expect(q2).toHaveTextContent('HIGH');
    expect(q2).toHaveTextContent('0.74');

    // Sorted by position: q1 (position 1) renders before q2 (position 2).
    const items = screen.getAllByTestId(/queue-item-/);
    expect(items[0]).toBe(q1);
    expect(items[1]).toBe(q2);
  });

  it('shows a 409 toast and refetches when a claim loses', async () => {
    mocked.listQueue.mockResolvedValue([item('q1', 1, 'HIGH', 0.74, false)]);
    mocked.claim.mockRejectedValue(new ReviewApiError(409, 'already claimed'));

    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /Claim/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else claimed');
    expect(mocked.listQueue).toHaveBeenCalled();
  });
});
