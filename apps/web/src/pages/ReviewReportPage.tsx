import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { reviewsApi, type ReviewDecision } from '../api/reviews';

/** A small colour band for a finding severity, so the eye sorts CRITICAL from NIT. */
function severityColor(severity: string): string {
  switch (severity) {
    case 'CRITICAL':
      return '#cf222e';
    case 'MAJOR':
      return '#bc4c00';
    case 'MINOR':
      return '#9a6700';
    default:
      return '#57606a';
  }
}

/**
 * AI review report page (review-reorient Phase 3) — the pivot's read surface.
 * Renders the two distinct sections the user asked for side by side: "what the
 * AI found" (findings) and "what the AI recommends" (fix suggestions), plus the
 * summary/verdict and a human decision form.
 */
export default function ReviewReportPage(): JSX.Element {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reviewReport', id],
    queryFn: () => reviewsApi.getReport(id),
    enabled: id !== '',
  });

  const decide = useMutation({
    mutationFn: () => reviewsApi.decide(id, decision as ReviewDecision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviewReport', id] }),
    onError: (error: unknown) =>
      setSubmitError(error instanceof Error ? error.message : 'Decision failed.'),
  });

  if (isLoading) {
    return <p>Loading report…</p>;
  }
  if (isError || !data) {
    return <p>Could not load this review report.</p>;
  }

  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: 16 }}>
      <p>
        <Link to="/reviews/new">← New review</Link>
      </p>

      <h2 style={{ marginBottom: 4 }}>{data.prTitle}</h2>
      <p style={{ color: '#57606a', marginTop: 0 }}>
        <a href={data.prUrl} target="_blank" rel="noreferrer">
          {data.prUrl}
        </a>{' '}
        · {data.aiProvider}/{data.model}
      </p>

      <section
        style={{
          border: '1px solid #d0d7de',
          borderRadius: 6,
          padding: 12,
          background: '#f6f8fa',
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>Verdict:</strong> {data.overallVerdict}
        </p>
        <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{data.summary}</p>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 16 }}>
        <section>
          <h3 style={{ marginTop: 0 }}>Findings ({data.findings.length})</h3>
          {data.findings.length === 0 && <p>No findings.</p>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {data.findings.map((finding) => (
              <li
                key={finding.id}
                style={{
                  border: '1px solid #d0d7de',
                  borderRadius: 6,
                  padding: 8,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ color: severityColor(finding.severity) }}>
                    {finding.severity}
                  </strong>
                  <code>
                    {finding.file}
                    {finding.line !== null ? `:${finding.line}` : ''}
                  </code>
                </div>
                <p style={{ margin: '8px 0 0' }}>{finding.message}</p>
                {finding.suggestion !== null && (
                  <p style={{ margin: '8px 0 0', color: '#57606a' }}>{finding.suggestion}</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 style={{ marginTop: 0 }}>Fix suggestions ({data.suggestions.length})</h3>
          {data.suggestions.length === 0 && <p>No fix suggestions.</p>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {data.suggestions.map((suggestion) => (
              <li
                key={suggestion.id}
                style={{
                  border: '1px solid #d0d7de',
                  borderRadius: 6,
                  padding: 8,
                  marginBottom: 8,
                }}
              >
                <code>{suggestion.file}</code>
                {suggestion.hunk !== null && (
                  <div style={{ color: '#57606a', fontSize: '0.85rem' }}>{suggestion.hunk}</div>
                )}
                <pre
                  style={{
                    background: '#f6f8fa',
                    border: '1px solid #d0d7de',
                    borderRadius: 6,
                    padding: 8,
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {suggestion.proposed}
                </pre>
                <p style={{ margin: '8px 0 0', color: '#57606a' }}>{suggestion.rationale}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section style={{ borderTop: '1px solid #d0d7de', marginTop: 16, paddingTop: 16 }}>
        <h3>Your decision</h3>
        {submitError && (
          <div
            role="alert"
            style={{
              background: '#ffebe9',
              color: '#cf222e',
              padding: 8,
              borderRadius: 6,
              marginBottom: 8,
            }}
          >
            {submitError}
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (decision !== null) {
              void decide.mutate();
            }
          }}
        >
          {(['APPROVE', 'REQUEST_CHANGES', 'REJECT'] as const).map((choice) => (
            <label key={choice} style={{ marginRight: 16 }}>
              <input
                type="radio"
                name="decision"
                value={choice}
                checked={decision === choice}
                onChange={() => setDecision(choice)}
              />{' '}
              {choice.replace('_', ' ')}
            </label>
          ))}
          <button
            type="submit"
            disabled={decision === null || decide.isPending}
            style={{ marginLeft: 8 }}
          >
            Submit
          </button>
        </form>
      </section>
    </main>
  );
}
