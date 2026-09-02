// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewsApi, type ReviewsListItem } from '../api/reviews';
import QueuePage from './QueuePage';

vi.mock('../api/reviews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/reviews')>();
  return {
    ...actual,
    reviewsApi: { ...actual.reviewsApi, list: vi.fn(), summary: vi.fn() },
  };
});

const mocked = vi.mocked(reviewsApi);

function renderQueue(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <QueuePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function item(id: string, overrides: Partial<ReviewsListItem> = {}): ReviewsListItem {
  return {
    id,
    prUrl: `https://github.com/acme/app/pull/${id}`,
    prNumber: Number(id),
    repo: 'github.com/acme/app',
    prTitle: `Review ${id}`,
    overallVerdict: 'REQUEST_CHANGES',
    createdAt: '2026-08-23T00:00:00.000Z',
    decided: false,
    decision: null,
    findingCount: 3,
    author: 'octocat',
    branch: { source: 'feature/x', target: 'main' },
    additions: 120,
    deletions: 40,
    filesChanged: 6,
    riskScore: 0,
    priority: 'low',
    criticalFindings: 0,
    findings: [],
    effectiveVerdict: 'REQUEST_CHANGES',
    triage: { securityBlocked: false, schemaGate: false, matchedRules: [] },
    ...overrides,
  };
}

describe('QueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.summary.mockResolvedValue({ pendingCount: 0, decidedCount: 0, approvedCount: 0 });
  });

  it('renders pending reviews, priority-ordered, with findings and Review now links', async () => {
    mocked.list.mockResolvedValue([
      item('1', {
        overallVerdict: 'APPROVE',
        prTitle: 'Low risk change',
        priority: 'low',
        riskScore: 5,
      }),
      item('2', {
        overallVerdict: 'REQUEST_CHANGES',
        prTitle: 'Needs changes',
        findingCount: 8,
        priority: 'high',
        riskScore: 80,
      }),
      item('3', {
        overallVerdict: 'COMMENT',
        prTitle: 'Some comments',
        findingCount: 1,
        priority: 'medium',
        riskScore: 12,
      }),
    ]);

    renderQueue();

    expect(await screen.findByText('Low risk change')).toBeInTheDocument();
    expect(screen.getByTestId('queue-count')).toHaveTextContent('3 pending');

    // Priority order: Request changes → Comment → Approve.
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Needs changes');
    expect(rows[1]).toHaveTextContent('Some comments');
    expect(rows[2]).toHaveTextContent('Low risk change');

    // Status, findings count, and priority are all surfaced.
    expect(rows[0]).toHaveTextContent('Request changes');
    expect(rows[0]).toHaveTextContent('8 findings');
    expect(rows[0]).toHaveTextContent('High priority');
    expect(rows[1]).toHaveTextContent('1 finding');

    // The primary action links into the report of the top-priority review.
    const links = screen.getAllByRole('link', { name: /Review now/ });
    expect(links[0]).toHaveAttribute('href', '/reviews/2');
  });

  it('shows a positive empty state with a create action', async () => {
    mocked.list.mockResolvedValue([]);

    renderQueue();

    expect(await screen.findByText(/caught up/)).toBeInTheDocument();
    expect(screen.getByText(/no AI reviews waiting for your attention/)).toBeInTheDocument();

    const empty = screen.getByTestId('empty-state');
    expect(within(empty).getByRole('link', { name: /Create New Review/ })).toHaveAttribute(
      'href',
      '/reviews/new',
    );
  });

  it('filters by verdict and narrows by search text', async () => {
    mocked.list.mockResolvedValue([
      item('1', { overallVerdict: 'REQUEST_CHANGES', prTitle: 'Wire write-back' }),
      item('2', { overallVerdict: 'APPROVE', prTitle: 'Bump dependency' }),
    ]);

    renderQueue();

    await screen.findByText('Wire write-back');

    // Verdict filter keeps only APPROVE.
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.queryByText('Wire write-back')).not.toBeInTheDocument();
    expect(screen.getByText('Bump dependency')).toBeInTheDocument();

    // Back to All, then search narrows by title.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Search reviews'), { target: { value: 'write-back' } });
    expect(screen.getByText('Wire write-back')).toBeInTheDocument();
    expect(screen.queryByText('Bump dependency')).not.toBeInTheDocument();
  });
});
