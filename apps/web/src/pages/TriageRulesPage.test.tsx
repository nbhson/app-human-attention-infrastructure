// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { triageRulesApi } from '../api/triageRules';
import TriageRulesPage from './TriageRulesPage';

vi.mock('../api/triageRules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/triageRules')>();
  return {
    ...actual,
    triageRulesApi: { ...actual.triageRulesApi, get: vi.fn(), update: vi.fn() },
  };
});

const mocked = vi.mocked(triageRulesApi);

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TriageRulesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const DEFAULT_STATE = {
  securityBlock: true,
  performanceRegression: true,
  schemaIntegrity: true,
};

describe('TriageRulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reflects the fetched state for the three wired rules', async () => {
    mocked.get.mockResolvedValue({
      securityBlock: true,
      performanceRegression: false,
      schemaIntegrity: true,
    });

    renderPage();

    const security = await screen.findByRole('switch', {
      name: /Critical security findings/,
    });
    const performance = screen.getByRole('switch', {
      name: /High-risk performance regressions/,
    });
    expect(security).toHaveAttribute('aria-checked', 'true');
    expect(performance).toHaveAttribute('aria-checked', 'false');
  });

  it('persists a toggle through the update endpoint', async () => {
    mocked.get.mockResolvedValue(DEFAULT_STATE);
    mocked.update.mockResolvedValue({ ...DEFAULT_STATE, securityBlock: false });

    renderPage();

    const toggle = await screen.findByRole('switch', { name: /Critical security findings/ });
    fireEvent.click(toggle);

    await waitFor(() => expect(mocked.update).toHaveBeenCalledWith({ securityBlock: false }));
  });
});
