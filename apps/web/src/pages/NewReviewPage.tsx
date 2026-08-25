import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { reviewsApi } from '../api/reviews';
import { Skeleton } from '../components/Skeleton';

/**
 * New AI review page (review-reorient Phase 3) — the pivot's entry point. A
 * human pastes a PR URL (+ an optional Jira ticket key); the harness fetches the
 * diff, the AI reviews it as a *reviewer*, and the browser lands on the report.
 *
 * The submit path is asynchronous and can take minutes, so the page replaces the
 * one-word "Reviewing…" button with a progress panel that names each stage — the
 * reviewer otherwise has no idea anything is happening.
 */

/** Light-weight client-side check; the API is the authoritative validator. */
function validatePrUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'The URL must use http(s).';
    }
    return null;
  } catch {
    return 'This does not look like a valid URL.';
  }
}

function progressStep(label: string, active: boolean): JSX.Element {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: active ? 'var(--color-info)' : 'var(--color-border)',
        }}
      />
      <span style={{ color: active ? 'var(--color-text)' : 'var(--color-text-faint)' }}>
        {label}
      </span>
    </li>
  );
}

export default function NewReviewPage(): JSX.Element {
  const navigate = useNavigate();
  const [prUrl, setPrUrl] = useState('');
  const [jiraTicket, setJiraTicket] = useState('');
  const [error, setError] = useState<string | null>(null);

  const prUrlError = validatePrUrl(prUrl);

  const create = useMutation({
    mutationFn: () =>
      reviewsApi.create({
        prUrl: prUrl.trim(),
        ...(jiraTicket.trim().length > 0 ? { jiraTicket: jiraTicket.trim() } : {}),
      }),
    onSuccess: (result) => navigate(`/reviews/${result.reportId}`),
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Review failed.'),
  });

  const canSubmit = prUrl.trim().length > 0 && prUrlError === null && !create.isPending;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <p>
        <Link to="/review">← Review queue</Link>
      </p>
      <h2>New AI code review</h2>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Paste a pull request URL. The AI will read the diff, weigh it against a requirement
        (optional Jira ticket), and return a review report plus fix suggestions — no code is
        written.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--color-danger-bg)',
            color: 'var(--color-danger)',
            padding: 8,
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {create.isPending && (
        <div
          role="status"
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            padding: 12,
            marginBottom: 12,
            background: 'var(--color-surface)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Review in progress…</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {progressStep('Reading the pull request diff', true)}
            {progressStep(
              jiraTicket.trim() ? 'Loading the Jira ticket' : 'No ticket provided',
              jiraTicket.trim().length > 0,
            )}
            {progressStep('AI writing its review', true)}
          </ul>
          <div style={{ marginTop: 12 }}>
            <Skeleton height={10} />
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Skeleton height={10} />
              <Skeleton height={10} />
            </div>
          </div>
          <p style={{ margin: '12px 0 0', color: 'var(--color-text-faint)', fontSize: '0.85rem' }}>
            This can take a few minutes. You'll land on the report when it's ready.
          </p>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            void create.mutate();
          }
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="prUrl" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
            Pull request URL
          </label>
          <input
            id="prUrl"
            value={prUrl}
            onChange={(event) => setPrUrl(event.target.value)}
            placeholder="https://github.com/acme/app/pull/123"
            aria-invalid={prUrlError !== null}
            style={{
              width: '100%',
              padding: 8,
              boxSizing: 'border-box',
              border: `1px solid ${prUrlError !== null ? 'var(--color-danger)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius)',
            }}
          />
          {prUrlError !== null && (
            <span role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>
              {prUrlError}
            </span>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="jiraTicket"
            style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}
          >
            Jira ticket (optional)
          </label>
          <input
            id="jiraTicket"
            value={jiraTicket}
            onChange={(event) => setJiraTicket(event.target.value)}
            placeholder="ACME-1234"
            style={{
              width: '100%',
              padding: 8,
              boxSizing: 'border-box',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
            }}
          />
        </div>

        <button type="submit" disabled={!canSubmit}>
          {create.isPending ? 'Reviewing…' : 'Start review'}
        </button>
      </form>
    </main>
  );
}
