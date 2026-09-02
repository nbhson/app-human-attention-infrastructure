// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewsApi, type ReviewReport } from '../api/reviews';
import ReviewReportPage from './ReviewReportPage';

vi.mock('../api/reviews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/reviews')>();
  return {
    ...actual,
    reviewsApi: { ...actual.reviewsApi, getReport: vi.fn(), decide: vi.fn() },
  };
});

const mocked = vi.mocked(reviewsApi);

const report: ReviewReport = {
  id: 'report-abc',
  prUrl: 'https://github.com/acme/app/pull/123',
  prNumber: 123,
  repo: 'github.com/acme/app',
  prTitle: 'Add rate limiting',
  aiProvider: 'custom',
  model: 'gpt-4.1',
  summary: 'Solid change, one correctness concern.',
  overallVerdict: 'REQUEST_CHANGES',
  reviewStatus: 'complete',
  batchProgress: null,
  effectiveVerdict: 'REQUEST_CHANGES',
  triage: { securityBlocked: false, regressionRisk: false, schemaGate: false, matchedRules: [] },
  createdAt: '2026-08-23T00:00:00.000Z',
  stats: {
    totalFiles: 1,
    addedLines: 40,
    removedLines: 10,
    changedLines: 50,
    flaggedAddedLines: 1,
    flaggedFiles: 1,
    attentionShare: 1,
    findingTotal: 1,
    severity: { CRITICAL: 0, MAJOR: 1, MINOR: 0, NIT: 0, INFO: 0 },
    composition: [{ category: 'source', files: 1, additions: 40, deletions: 10 }],
    languages: [{ language: 'TypeScript', files: 1, additions: 40, deletions: 10, share: 1 }],
    excluded: { files: 0, additions: 0, deletions: 0, filesList: [] },
    flaggedFilesList: [{ file: 'src/limit.ts', severities: ['MAJOR'] }],
    cleanup: { files: 0, findings: 0, filesList: [] },
  },
  findings: [
    {
      id: 'finding-1',
      severity: 'MAJOR',
      kind: 'correctness',
      file: 'src/limit.ts',
      line: 42,
      message: 'Off-by-one in the window check.',
      suggestion: 'Compare against `>` instead of `>=`.',
      orderIndex: 0,
      anchor: { status: 'verified', detail: 'line 42 is in this diff' },
    },
  ],
  suggestions: [
    {
      id: 'suggestion-1',
      file: 'src/limit.ts',
      hunk: '@@ -42,3 +42,3 @@',
      proposed: 'if (count > limit) reject();',
      rationale: 'The current bounds gate admits one request too many.',
      orderIndex: 0,
    },
  ],
  diff: [
    {
      path: 'src/limit.ts',
      status: 'modified',
      additions: 40,
      deletions: 10,
      patch: '@@ -42,1 +42,1 @@\n-if (count >= limit) reject();\n+if (count > limit) reject();',
    },
  ],
  trace: {
    calls: [
      {
        model: 'gpt-4.1',
        inputTokens: 150,
        outputTokens: 80,
        stopReason: 'end_turn',
        requestHash: 'sha256-offbyone',
        createdAt: '2026-08-23T00:00:01.000Z',
      },
    ],
    judge: [],
  },
  decisions: [],
  writebacks: [],
  writeback: { enabled: true },
};

function renderReport(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/reviews/report-abc']}
      >
        <Routes>
          <Route path="/reviews/:id" element={<ReviewReportPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReviewReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders verdict, findings, and fix suggestions into distinct sections', async () => {
    mocked.getReport.mockResolvedValue(report);

    renderReport();

    expect(await screen.findByText('Add rate limiting')).toBeInTheDocument();
    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Request changes');
    // Findings are grouped by severity; the selected (first) finding's detail panel
    // shows its suggested fix alongside the scannable list card.
    expect(screen.getByRole('heading', { name: 'Major (1)' })).toBeInTheDocument();
    expect(screen.getAllByText('Off-by-one in the window check.').length).toBeGreaterThan(0);
    expect(screen.getByText('if (count > limit) reject();')).toBeInTheDocument();
  });

  it('submits a human decision to the decide endpoint', async () => {
    mocked.getReport.mockResolvedValue(report);
    mocked.decide.mockResolvedValue({ reportId: 'report-abc', decision: 'APPROVE' });

    renderReport();

    fireEvent.click(await screen.findByRole('radio', { name: /APPROVE/ }));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(await screen.findByRole('radio', { name: /APPROVE/ })).toBeChecked();
    expect(mocked.decide).toHaveBeenCalledWith('report-abc', {
      decision: 'APPROVE',
      writeback: true,
      comment: '',
    });
  });

  it('forwards an un-checked write-back and a comment to the decide call', async () => {
    mocked.getReport.mockResolvedValue(report);
    mocked.decide.mockResolvedValue({ reportId: 'report-abc', decision: 'APPROVE' });

    renderReport();

    fireEvent.click(await screen.findByRole('radio', { name: /APPROVE/ }));
    fireEvent.change(screen.getByLabelText(/Write-back comment/), {
      target: { value: 'LGTM' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Write decision back to PR/ }));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() =>
      expect(mocked.decide).toHaveBeenCalledWith('report-abc', {
        decision: 'APPROVE',
        writeback: false,
        comment: 'LGTM',
      }),
    );
  });

  it('disables the write-back checkbox and explains when the server is not armed', async () => {
    mocked.getReport.mockResolvedValue({ ...report, writeback: { enabled: false } });

    renderReport();

    const checkbox = await screen.findByRole('checkbox', {
      name: /Write decision back to PR/,
    });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/Write-back is disabled on this deployment/)).toBeInTheDocument();
  });
});
