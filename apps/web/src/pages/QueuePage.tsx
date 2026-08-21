import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ReviewApiError, reviewApi, type QueueListItem } from '../api/review';
import { LabelBadge } from '../components/LabelBadge';

function isEscalate(item: QueueListItem): boolean {
  return item.label === 'ESCALATE';
}

/**
 * Review queue page (day-23 §2.2) — prioritized list with label badges, score,
 * flaky markers, and one-click claim. Polls every 5 s; claim mutations
 * invalidate the queue so the row leaves once it is claimed.
 */
export default function QueuePage(): JSX.Element {
  const queryClient = useQueryClient();
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const {
    data: items = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['reviewQueue'],
    queryFn: () => reviewApi.listQueue(),
    refetchInterval: 5_000,
  });

  const claim = useMutation({
    mutationFn: (id: string) => reviewApi.claim(id),
    onSuccess: async () => {
      setConflictMessage(null);
      await queryClient.invalidateQueries({ queryKey: ['reviewQueue'] });
    },
    onError: (error: unknown) => {
      if (error instanceof ReviewApiError && error.status === 409) {
        setConflictMessage('Someone else claimed that item — refreshing the queue.');
        void queryClient.invalidateQueries({ queryKey: ['reviewQueue'] });
      }
    },
  });

  const sorted = [...items].sort((a, b) => a.position - b.position);

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 16 }}>
      <h2>Review Queue ({sorted.length})</h2>
      {conflictMessage && (
        <div
          role="alert"
          style={{
            background: '#fff3cd',
            color: '#7a5b00',
            padding: 8,
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          {conflictMessage}
        </div>
      )}
      {isLoading && <p>Loading queue…</p>}
      {isError && <p>Could not load the review queue.</p>}
      {!isLoading && !isError && sorted.length === 0 && <p>The queue is empty.</p>}
      {sorted.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>#</th>
              <th style={{ textAlign: 'left' }}>Label</th>
              <th style={{ textAlign: 'left' }}>Score</th>
              <th style={{ textAlign: 'left' }}>Task</th>
              <th style={{ textAlign: 'left' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr key={item.id}>
                <td>{item.position}</td>
                <td>
                  {isEscalate(item) && <strong style={{ color: '#b91c1c' }}>⚠ </strong>}
                  <LabelBadge label={item.label} /> {item.flaky && <span title="flaky">*</span>}
                </td>
                <td>{item.combinedPriority.toFixed(2)}</td>
                <td>
                  {item.taskTitle}
                  <div style={{ color: '#6e7781', fontSize: '0.85rem' }}>
                    {item.ruleId} · policy v{item.policyVersion}
                  </div>
                </td>
                <td style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Link to={`/review/${item.id}`}>Open</Link>
                  <button
                    type="button"
                    onClick={() => claim.mutate(item.id)}
                    disabled={claim.isPending}
                  >
                    Claim
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
