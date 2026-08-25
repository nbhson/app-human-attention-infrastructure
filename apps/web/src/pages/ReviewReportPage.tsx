import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { reviewsApi, type ReviewDecision } from '../api/reviews';
import { ReportStats } from '../components/ReportStats';
import { Skeleton, SkeletonLines } from '../components/Skeleton';
import { severityColor, severityLabel, sortFindingsBySeverity } from '../components/severity';

/**
 * AI review report page (review-reorient Phase 3) — the pivot's read surface.
 * Renders a glanceable dashboard (verdict + attention share + severity split)
 * above the two distinct sections the user asked for — "what the AI found"
 * (findings, worst-first) and "what the AI recommends" (fix suggestions) — and a
 * sticky human-decision bar that stays visible however long the list grows.
 */

/** A radio's accessible name stays the raw token so tests/AT read APPROVE; the
 *  visible chip shows a human label. */
const DECISION_LABEL: Record<ReviewDecision, string> = {
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
  REJECT: 'Reject',
};

const DECISION_TONE: Record<ReviewDecision, string> = {
  APPROVE: 'var(--color-success)',
  REQUEST_CHANGES: 'var(--color-warning)',
  REJECT: 'var(--color-danger)',
};

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

function reviewSkeleton(): JSX.Element {
  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: 16 }}>
      <Skeleton width={120} height={14} />
      <div style={{ marginTop: 16 }}>
        <Skeleton width="70%" height={28} />
        <div style={{ marginTop: 8 }}>
          <Skeleton width="55%" height={14} />
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <Skeleton height={200} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 16 }}>
        <SkeletonLines count={4} />
        <SkeletonLines count={4} />
      </div>
    </main>
  );
}

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
    return reviewSkeleton();
  }
  if (isError || !data) {
    return <p>Could not load this review report.</p>;
  }

  const findings = sortFindingsBySeverity(data.findings);

  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: 16, paddingBottom: 96 }}>
      <p style={{ margin: 0 }}>
        <Link to="/reviews/new">← New review</Link>
      </p>

      <h2 style={{ marginBottom: 4 }}>{data.prTitle}</h2>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>
        <a href={data.prUrl} target="_blank" rel="noreferrer">
          {data.prUrl}
        </a>{' '}
        · {data.aiProvider}/{data.model}
      </p>

      <ReportStats stats={data.stats} overallVerdict={data.overallVerdict} />

      <section
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: 12,
          background: 'var(--color-surface)',
          marginTop: 16,
        }}
      >
        <p
          style={{
            margin: 0,
            color: 'var(--color-text-faint)',
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }}
        >
          Summary
        </p>
        <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{data.summary}</p>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 16 }}>
        <section>
          <h3 style={{ marginTop: 0 }}>Findings ({data.findings.length})</h3>
          {data.findings.length === 0 && <p>No findings.</p>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {findings.map((finding) => (
              <li
                key={finding.id}
                style={{
                  border: '1px solid var(--color-border)',
                  borderLeft: `4px solid ${severityColor(finding.severity)}`,
                  borderRadius: 'var(--radius)',
                  padding: '8px 12px',
                  marginBottom: 8,
                  background: 'var(--color-surface-2)',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span
                    style={{
                      color: severityColor(finding.severity),
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    {severityLabel(finding.severity)}
                  </span>
                  <code>
                    {finding.file}
                    {finding.line !== null ? `:${finding.line}` : ''}
                  </code>
                </div>
                <p style={{ margin: '8px 0 0' }}>{finding.message}</p>
                {finding.suggestion !== null && (
                  <p style={{ margin: '8px 0 0', color: 'var(--color-text-muted)' }}>
                    {finding.suggestion}
                  </p>
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
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: '8px 12px',
                  marginBottom: 8,
                  background: 'var(--color-surface-2)',
                }}
              >
                <code>{suggestion.file}</code>
                {suggestion.hunk !== null && (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                    {suggestion.hunk}
                  </div>
                )}
                <pre
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: 8,
                    overflowX: 'auto',
                    whiteSpace: 'pre',
                  }}
                >
                  {suggestion.proposed}
                </pre>
                <p style={{ margin: '8px 0 0', color: 'var(--color-text-muted)' }}>
                  {suggestion.rationale}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 1,
          background: 'var(--color-bg)',
          borderTop: '1px solid var(--color-border)',
          paddingTop: 12,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Your decision</h3>
        {submitError && (
          <div
            role="alert"
            style={{
              background: 'var(--color-danger-bg)',
              color: 'var(--color-danger)',
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
          <div role="radiogroup" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(Object.keys(DECISION_LABEL) as ReviewDecision[]).map((choice) => {
              const selected = decision === choice;
              const tone = DECISION_TONE[choice];
              return (
                <label
                  key={choice}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '6px 14px',
                    borderRadius: '999px',
                    border: `1px solid ${selected ? tone : 'var(--color-border)'}`,
                    background: selected ? tone : 'var(--color-surface)',
                    color: selected ? '#ffffff' : 'var(--color-text)',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="decision"
                    value={choice}
                    aria-label={choice}
                    checked={selected}
                    onChange={() => setDecision(choice)}
                    style={visuallyHidden}
                  />
                  {DECISION_LABEL[choice]}
                </label>
              );
            })}
            <button
              type="submit"
              disabled={decision === null || decide.isPending}
              style={{
                padding: '6px 16px',
                borderRadius: '999px',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {decide.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
