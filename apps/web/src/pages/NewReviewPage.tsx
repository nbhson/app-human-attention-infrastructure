import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { reviewsApi } from '../api/reviews';

/**
 * New AI review page (review-reorient Phase 3) — the pivot's entry point. A
 * human pastes a PR URL (+ an optional Jira ticket key); the harness fetches the
 * diff, the AI reviews it as a *reviewer*, and the browser lands on the report.
 */
export default function NewReviewPage(): JSX.Element {
  const navigate = useNavigate();
  const [prUrl, setPrUrl] = useState('');
  const [jiraTicket, setJiraTicket] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      reviewsApi.create({
        prUrl: prUrl.trim(),
        ...(jiraTicket.trim().length > 0 ? { jiraTicket: jiraTicket.trim() } : {}),
      }),
    onSuccess: (result) => navigate(`/reviews/${result.reportId}`),
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Review failed.'),
  });

  const canSubmit = prUrl.trim().length > 0 && !create.isPending;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <p>
        <Link to="/review">← Review queue</Link>
      </p>
      <h2>New AI code review</h2>
      <p style={{ color: '#57606a' }}>
        Paste a pull request URL. The AI will read the diff, weigh it against a requirement
        (optional Jira ticket), and return a review report plus fix suggestions — no code is
        written.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            background: '#ffebe9',
            color: '#cf222e',
            padding: 8,
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {error}
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
            style={{ width: '100%', padding: 8 }}
          />
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
            style={{ width: '100%', padding: 8 }}
          />
        </div>

        <button type="submit" disabled={!canSubmit}>
          {create.isPending ? 'Reviewing…' : 'Start review'}
        </button>
      </form>
    </main>
  );
}
