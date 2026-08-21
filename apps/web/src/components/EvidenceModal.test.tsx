// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { reviewApi } from '../api/review';
import { EvidenceModal } from './EvidenceModal';

function renderModal(evidenceId: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EvidenceModal evidenceId={evidenceId} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('EvidenceModal', () => {
  it('fetches and renders the evidence body', async () => {
    const getEvidence = vi
      .spyOn(reviewApi, 'getEvidence')
      .mockResolvedValue({ id: 'evt-1', kind: 'COMPILE', body: 'BUILD OK\n42 tests' });

    renderModal('evt-1');

    expect(await screen.findByTestId('evidence-body')).toHaveTextContent('BUILD OK');
    expect(screen.getByText(/kind: COMPILE/)).toBeInTheDocument();
    expect(getEvidence).toHaveBeenCalledWith('evt-1');
  });
});
