import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ReviewApiError, reviewApi, type QueueListItem } from '../api/review';
import { reviewsApi } from '../api/reviews';
import { LabelBadge } from '../components/LabelBadge';
import { Skeleton } from '../components/Skeleton';

function isEscalate(item: QueueListItem): boolean {
  return item.label === 'ESCALATE';
}

/** Label → priority rail colour (matches the badge ramp). */
const PRIORITY_RAIL: Record<string, string> = {
  CRITICAL: 'var(--prio-critical)',
  HIGH: 'var(--prio-high)',
  MEDIUM: 'var(--prio-medium)',
  LOW: 'var(--prio-low)',
};

const FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

/**
 * Review queue page (day-23 §2.2) — prioritized list with label badges, a score
 * bar (not a bare decimal), flaky/claimed markers, a label filter, and one-click
 * claim. Polls every 5 s; claim mutations invalidate the queue so the row leaves
 * once it is claimed.
 */
export default function QueuePage(): JSX.Element {
  const queryClient = useQueryClient();
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');

  const {
    data: items = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['reviewQueue'],
    queryFn: () => reviewApi.listQueue(),
    refetchInterval: 5_000,
  });

  const {
    data: pendingReviews = [],
    isLoading: pendingReviewsLoading,
    isError: pendingReviewsError,
  } = useQuery({
    queryKey: ['pendingReviews'],
    queryFn: () => reviewsApi.list(true),
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
  const visible = filter === 'ALL' ? sorted : sorted.filter((item) => item.label === filter);

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0 }}>
          <Link to="/reviews/new">+ New AI review</Link>
        </p>
        <p style={{ margin: 0 }}>
          <Link to="/audit">System activity →</Link>
        </p>
      </div>

      <section aria-label="Reviews awaiting a decision" style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Reviews awaiting a decision ({pendingReviews.length})</h2>
        {pendingReviewsLoading && (
          <div style={{ display: 'grid', gap: 8 }}>
            <Skeleton height={44} />
          </div>
        )}
        {!pendingReviewsLoading && pendingReviewsError && <p>Could not load pending reviews.</p>}
        {!pendingReviewsLoading && !pendingReviewsError && pendingReviews.length === 0 && (
          <p>No review requests are waiting on a decision.</p>
        )}
        {!pendingReviewsLoading && !pendingReviewsError && pendingReviews.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {pendingReviews.map((item) => (
              <li
                key={item.id}
                data-testid={`pending-review-${item.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: '10px 12px',
                  background: 'var(--color-surface-2)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{item.prTitle}</div>
                  <div style={{ color: 'var(--color-text-faint)', fontSize: '0.85rem' }}>
                    {item.repo} · #{item.prNumber} · {item.overallVerdict}
                  </div>
                </div>
                <Link to={`/reviews/${item.id}`}>Continue review</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2>Review Queue ({sorted.length})</h2>

      {conflictMessage && (
        <div
          role="alert"
          style={{
            background: 'var(--color-warning-bg)',
            color: 'var(--color-warning)',
            padding: 8,
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          {conflictMessage}
        </div>
      )}

      {!isLoading && !isError && sorted.length > 0 && (
        <div
          role="group"
          aria-label="Filter by priority"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}
        >
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              style={{
                padding: '3px 12px',
                borderRadius: '999px',
                border: `1px solid ${filter === option ? 'var(--color-info)' : 'var(--color-border)'}`,
                background: filter === option ? 'var(--color-info)' : 'var(--color-surface-2)',
                color: filter === option ? '#ffffff' : 'var(--color-text)',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {option === 'ALL' ? 'All' : option}
            </button>
          ))}
        </div>
      )}

      {isLoading && (
        <div style={{ display: 'grid', gap: 8 }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} height={56} />
          ))}
        </div>
      )}

      {isError && <p>Could not load the review queue.</p>}
      {!isLoading && !isError && sorted.length === 0 && <p>The queue is empty.</p>}

      {!isLoading && !isError && visible.length === 0 && sorted.length > 0 && (
        <p>Nothing matches this filter.</p>
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {visible.map((item) => {
            const rail =
              item.claimedBy !== null
                ? 'var(--color-border)'
                : (PRIORITY_RAIL[item.label] ?? 'var(--prio-low)');
            return (
              <li
                key={item.id}
                data-testid={`queue-item-${item.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  border: '1px solid var(--color-border)',
                  borderLeft: `4px solid ${rail}`,
                  borderRadius: 'var(--radius)',
                  background: 'var(--color-surface-2)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ flex: 1, padding: '10px 12px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {isEscalate(item) && <span aria-label="escalated">⚠</span>}
                    <LabelBadge label={item.label} />
                    {item.flaky && (
                      <span
                        title="flaky"
                        style={{
                          border: '1px solid var(--color-warning)',
                          color: 'var(--color-warning)',
                          borderRadius: '999px',
                          padding: '0 8px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                        }}
                      >
                        flaky
                      </span>
                    )}
                    {item.claimedBy !== null && (
                      <span style={{ color: 'var(--color-text-faint)', fontSize: '0.8rem' }}>
                        held by {item.claimedBy}
                      </span>
                    )}
                  </div>

                  <div style={{ marginTop: 6, fontWeight: 600 }}>{item.taskTitle}</div>
                  <div style={{ color: 'var(--color-text-faint)', fontSize: '0.85rem' }}>
                    {item.ruleId} · policy v{item.policyVersion}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <div
                      role="img"
                      aria-label={`priority ${item.combinedPriority.toFixed(2)}`}
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: '999px',
                        background: 'var(--color-border)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round(item.combinedPriority * 100)}%`,
                          height: '100%',
                          background: PRIORITY_RAIL[item.label] ?? 'var(--prio-low)',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        color: 'var(--color-text-muted)',
                        fontSize: '0.85rem',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {item.combinedPriority.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    borderLeft: '1px solid var(--color-border)',
                    padding: '0 12px',
                  }}
                >
                  <Link to={`/review/${item.id}`}>Open</Link>
                  <button
                    type="button"
                    onClick={() => claim.mutate(item.id)}
                    disabled={claim.isPending}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '999px',
                      border: '1px solid var(--color-info)',
                      background: 'var(--color-info)',
                      color: '#ffffff',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Claim
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
