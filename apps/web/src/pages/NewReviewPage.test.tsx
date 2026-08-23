// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewsApi, type ReviewCreatedResult } from '../api/reviews';
import NewReviewPage from './NewReviewPage';

vi.mock('../api/reviews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/reviews')>();
  return { ...actual, reviewsApi: { ...actual.reviewsApi, create: vi.fn() } };
});

const mocked = vi.mocked(reviewsApi);

function renderNewReview(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reviews/new']}>
        <Routes>
          <Route path="/reviews/new" element={<NewReviewPage />} />
          <Route path="/reviews/:id" element={<p>report-page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const created: ReviewCreatedResult = {
  reportId: 'report-abc',
  taskId: 'task-abc',
  prUrl: 'https://github.com/acme/app/pull/123',
  overallVerdict: 'REQUEST_CHANGES',
  findingCount: 3,
  suggestionCount: 2,
};

describe('NewReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits a PR URL and navigates to the resulting report', async () => {
    mocked.create.mockResolvedValue(created);

    renderNewReview();

    fireEvent.change(screen.getByLabelText('Pull request URL'), {
      target: { value: 'https://github.com/acme/app/pull/123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start review/ }));

    expect(await screen.findByText('report-page')).toBeInTheDocument();
    expect(mocked.create).toHaveBeenCalledWith({ prUrl: 'https://github.com/acme/app/pull/123' });
  });

  it('includes a Jira ticket when one is provided', async () => {
    mocked.create.mockResolvedValue(created);

    renderNewReview();

    fireEvent.change(screen.getByLabelText('Pull request URL'), {
      target: { value: 'https://github.com/acme/app/pull/123' },
    });
    fireEvent.change(screen.getByLabelText(/Jira ticket/), { target: { value: 'ACME-42' } });
    fireEvent.click(screen.getByRole('button', { name: /Start review/ }));

    expect(await screen.findByText('report-page')).toBeInTheDocument();
    expect(mocked.create).toHaveBeenCalledWith({
      prUrl: 'https://github.com/acme/app/pull/123',
      jiraTicket: 'ACME-42',
    });
  });
});
