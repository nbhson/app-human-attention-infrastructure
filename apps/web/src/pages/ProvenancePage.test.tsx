// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { provenanceApi, type ProvenanceChain } from '../api/provenance';
import ProvenancePage from './ProvenancePage';

vi.mock('../api/provenance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/provenance')>();
  return { ...actual, provenanceApi: { getChain: vi.fn() } };
});

const mocked = vi.mocked(provenanceApi);

const TASK_ID = 'task-1';

function chain(state: string): ProvenanceChain {
  return {
    task: { id: TASK_ID, title: 'Fix the greeting bug', state },
    agentRun: {
      id: 'run-1',
      status: state === 'COMPLETED' ? 'COMPLETED' : 'ESCALATED',
      attemptNumber: 1,
    },
    llmCalls: [{ id: 'llm-1', model: 'claude-sonnet-4-6' }],
    trajectory: [{ id: 'step-1', stepNumber: 1, toolName: 'read_file' }],
    artifacts: [{ id: 'art-1', filePath: 'src/greeting.ts', contentHash: '9f2c0d0e1a2b3c4d' }],
    verification: {
      reports: [{ id: 'rep-1', overall: 'PASSED' }],
      checkResults: [{ id: 'check-1', checkKind: 'COMPILE', status: 'PASSED' }],
      evidenceIds: ['ev-1'],
    },
    events: [
      { eventId: 'e1', eventType: 'task.state_changed', occurredAt: '2026-08-22T00:00:00.000Z' },
      {
        eventId: 'e2',
        eventType: 'verification.completed',
        occurredAt: '2026-08-22T00:00:01.500Z',
      },
    ],
  };
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/tasks/${TASK_ID}/provenance`]}>
        <Routes>
          <Route path="/tasks/:id/provenance" element={<ProvenancePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProvenancePage', () => {
  it('renders all seven sections for a COMPLETED task', async () => {
    mocked.getChain.mockResolvedValue(chain('COMPLETED'));

    renderPage();

    expect(await screen.findByText('Fix the greeting bug')).toBeInTheDocument();
    expect(screen.getByText(/State:/)).toHaveTextContent('COMPLETED');
    expect(screen.getByText('Agent Run')).toBeInTheDocument();
    expect(screen.getByText(/LLM Calls \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Trajectory \(1 steps\)/)).toBeInTheDocument();
    expect(screen.getByText(/Artifacts \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Verification')).toBeInTheDocument();
    expect(screen.getByText(/Events \(2\)/)).toBeInTheDocument();
    // Timeline events render their typed offset labels.
    expect(screen.getByText('task.state_changed')).toBeInTheDocument();
    expect(screen.getByText('verification.completed')).toBeInTheDocument();
  });

  it('renders the same sections for a FAILED task', async () => {
    mocked.getChain.mockResolvedValue(chain('FAILED'));

    renderPage();

    expect(await screen.findByText('Fix the greeting bug')).toBeInTheDocument();
    expect(screen.getByText(/State:/)).toHaveTextContent('FAILED');
    expect(screen.getByText('Agent Run')).toBeInTheDocument();
    expect(screen.getByText('Verification')).toBeInTheDocument();
    expect(screen.getByText(/Events \(2\)/)).toBeInTheDocument();
  });
});
