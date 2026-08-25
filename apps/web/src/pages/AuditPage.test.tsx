// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auditApi, type AuditEntry, type AuditPage as AuditPageResult } from '../api/audit';
import AuditPage from './AuditPage';

vi.mock('../api/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/audit')>();
  return { ...actual, auditApi: { ...actual.auditApi, list: vi.fn() } };
});

const mocked = vi.mocked(auditApi);

function renderAudit(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function entry(
  id: string,
  kind: AuditEntry['kind'],
  occurredAt: string,
  title: string,
): AuditEntry {
  return {
    id,
    kind,
    occurredAt,
    correlationId: 'corr-1',
    actor: null,
    title,
    summary: 'a summary',
    detail: { key: 'value' },
  };
}

function page(items: AuditEntry[], nextBefore: string | null = null): AuditPageResult {
  return { items, nextBefore };
}

describe('AuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a unified timeline with kind labels and click-through detail', async () => {
    mocked.list.mockResolvedValue(
      page([
        entry('e1', 'event', '2026-08-25T10:00:00.000Z', 'review.report_created'),
        entry('l1', 'llm', '2026-08-25T10:00:01.000Z', 'claude-sonnet-4-6'),
      ]),
    );

    renderAudit();

    expect(await screen.findByText(/System activity/)).toBeInTheDocument();
    // Every row appears with its headline.
    expect(screen.getByText('review.report_created')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument();
    // Kind labels render (each kind appears because both rows are in the list).
    expect(screen.getAllByText('LLM call').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Event').length).toBeGreaterThan(0);

    // Click the LLM row → its detail panel shows the model/token grid.
    fireEvent.click(screen.getByText('claude-sonnet-4-6'));
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
  });

  it('filters by kind via the All/kinds chips', async () => {
    mocked.list
      .mockResolvedValueOnce(
        page([entry('e1', 'event', '2026-08-25T10:00:00.000Z', 'task.created')]),
      )
      .mockResolvedValueOnce(page([entry('l1', 'llm', '2026-08-25T10:00:01.000Z', 'model-x')]));

    renderAudit();

    expect(await screen.findByText('task.created')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'LLM call' }));

    expect(await screen.findByText('model-x')).toBeInTheDocument();
    expect(screen.queryByText('task.created')).not.toBeInTheDocument();
    // The LLM filter was passed through to the API.
    expect(mocked.list).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'llm' }));
  });
});
