// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ReviewsApiError,
  reviewsApi,
  type ReviewCreatedResult,
  type ReviewReport,
  type ReviewVerification,
} from '../api/reviews';
import NewReviewPage from './NewReviewPage';

vi.mock('../api/reviews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/reviews')>();
  return {
    ...actual,
    reviewsApi: { ...actual.reviewsApi, create: vi.fn(), getReport: vi.fn() },
  };
});

const mocked = vi.mocked(reviewsApi);

function renderNewReview(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/reviews/new']}
      >
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
  status: 'pending',
};

const VALID_URL = 'https://github.com/acme/app/pull/123';

const VERIFIED: ReviewVerification = {
  status: 'PASSED',
  overall: 'PASSED',
  headSha: 'abc123',
  contentHash: null,
  durationMs: 1200,
  failedKinds: [],
  timedOutKinds: [],
  failedChecks: [],
  rendered: null,
  error: null,
};

function fillValidUrl(): void {
  fireEvent.change(screen.getByLabelText(/Pull request URL/), { target: { value: VALID_URL } });
}

describe('NewReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The verification poll reads the report; most tests don't exercise it, so
    // default it to a failed read (→ the neutral "starting" note, no polling).
    mocked.getReport.mockRejectedValue(new Error('not tracked in this test'));
  });

  it('disables Start Review until the URL is valid, and explains invalid input', async () => {
    renderNewReview();

    const button = screen.getByRole('button', { name: /Start Review/ });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Pull request URL/), { target: { value: 'not-a-url' } });
    expect(await screen.findByText("That's not a valid URL.")).toBeInTheDocument();
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Pull request URL/), {
      target: { value: 'https://github.com/acme/app' },
    });
    expect(
      await screen.findByText('Paste the full pull request URL — it should end in /pull/123.'),
    ).toBeInTheDocument();
    expect(button).toBeDisabled();

    fillValidUrl();
    expect(button).toBeEnabled();
  });

  it('shows honest indeterminate progress while in flight, then a success state linking to the report', async () => {
    let resolveCreate!: (result: ReviewCreatedResult) => void;
    mocked.create.mockReturnValue(
      new Promise<ReviewCreatedResult>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    renderNewReview();
    fillValidUrl();
    fireEvent.click(screen.getByRole('button', { name: /Start Review/ }));

    // Honest progress: a single in-flight indicator, no fabricated per-stage list.
    expect(await screen.findByText('Starting AI Review')).toBeInTheDocument();
    expect(screen.getByText(/Review in progress/)).toBeInTheDocument();
    expect(screen.queryByText('Pull request received')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start Review/ })).not.toBeInTheDocument();

    resolveCreate(created);

    expect(await screen.findByText('Review submitted')).toBeInTheDocument();
    expect(mocked.create).toHaveBeenCalledWith({ prUrl: VALID_URL });
    const viewLink = screen.getByRole('link', { name: /View Review/ });
    expect(viewLink).toHaveAttribute('href', '/reviews/report-abc');
  });

  it('surfaces the real sandbox verification status once the report lands', async () => {
    mocked.create.mockResolvedValue(created);
    mocked.getReport.mockResolvedValue({ verification: VERIFIED } as unknown as ReviewReport);

    renderNewReview();
    fillValidUrl();
    fireEvent.click(screen.getByRole('button', { name: /Start Review/ }));

    expect(await screen.findByText('Review submitted')).toBeInTheDocument();
    expect(await screen.findByText('Sandbox verification')).toBeInTheDocument();
    expect(screen.getByTestId('sandbox-status')).toHaveTextContent('passed');
    expect(mocked.getReport).toHaveBeenCalledWith('report-abc');
  });

  it('includes a Jira ticket when one is provided', async () => {
    mocked.create.mockResolvedValue(created);

    renderNewReview();
    fillValidUrl();
    fireEvent.change(screen.getByLabelText(/Jira ticket/), { target: { value: 'ACME-42' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Review/ }));

    expect(await screen.findByText('Review submitted')).toBeInTheDocument();
    expect(mocked.create).toHaveBeenCalledWith({ prUrl: VALID_URL, jiraTicket: 'ACME-42' });
  });

  it('shows a clear error state and returns to the form on Try Again', async () => {
    mocked.create.mockRejectedValue(
      new ReviewsApiError(404, 'That pull request could not be found or is not accessible.'),
    );

    renderNewReview();
    fillValidUrl();
    fireEvent.click(screen.getByRole('button', { name: /Start Review/ }));

    expect(await screen.findByText('Pull request not found.')).toBeInTheDocument();
    expect(
      screen.getByText('That pull request could not be found or is not accessible.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Try Again/ }));
    await waitFor(() => expect(screen.getByLabelText(/Pull request URL/)).toBeInTheDocument());
    // The entry is preserved for editing.
    expect(screen.getByLabelText(/Pull request URL/)).toHaveValue(VALID_URL);
  });
});
