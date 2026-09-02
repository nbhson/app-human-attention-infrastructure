import { useQuery } from '@tanstack/react-query';
import { reviewApi } from '../api/review';

/**
 * Evidence modal (day-23 §2.3) — renders a single evidence body on demand.
 * "Claim ≠ Evidence" made literal: the modal is opened from a PASSED/FLAKY
 * badge and loads the raw check output / test JSON via `GET /api/review/evidence/:id`.
 */
export function EvidenceModal({
  evidenceId,
  onClose,
}: {
  readonly evidenceId: string;
  readonly onClose: () => void;
}): JSX.Element {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['evidence', evidenceId],
    queryFn: () => reviewApi.getEvidence(evidenceId),
    staleTime: 60_000,
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Evidence"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: 'var(--color-surface-2)',
          color: 'var(--color-text)',
          padding: 16,
          borderRadius: 8,
          maxWidth: 720,
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Evidence</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          {isLoading && <p>Loading evidence…</p>}
          {isError && <p>Could not load evidence {evidenceId}.</p>}
          {data && (
            <>
              <p style={{ color: 'var(--color-text-faint)', fontSize: '0.85rem' }}>kind: {data.kind}</p>
              <pre
                data-testid="evidence-body"
                style={{
                  whiteSpace: 'pre-wrap',
                  background: 'var(--color-surface)',
                  padding: 8,
                  borderRadius: 6,
                  fontSize: '0.8rem',
                }}
              >
                {data.body}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
