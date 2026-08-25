import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { reviewsApi, type ReviewDecision } from '../api/reviews';
import { AnchorBadge } from '../components/AnchorBadge';
import { DiffTab } from '../components/DiffTab';
import { ReportStats } from '../components/ReportStats';
import { Skeleton, SkeletonLines } from '../components/Skeleton';
import { TraceTab } from '../components/TraceTab';
import { severityColor, severityLabel, sortFindingsBySeverity } from '../components/severity';

/**
 * AI review report page (review-reorient Phase 3) — the pivot's read surface.
 * A glanceable dashboard (verdict + attention share + severity split) above a
 * tabbed detail area (Review / Diff / AI trace / Verification) and a sticky
 * human-decision bar — so a reviewer sees the claims, the exact changed code they
 * point at, how they were produced, and everything we can prove about it.
 */

type ReviewTab = 'review' | 'diff' | 'trace' | 'verification';

const TABS: readonly { key: ReviewTab; label: string }[] = [
  { key: 'review', label: 'Review' },
  { key: 'diff', label: 'Diff' },
  { key: 'trace', label: 'AI trace' },
  { key: 'verification', label: 'Verification' },
];

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
  const [writeback, setWriteback] = useState(false);
  const [comment, setComment] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReviewTab>('review');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reviewReport', id],
    queryFn: () => reviewsApi.getReport(id),
    enabled: id !== '',
  });

  const decide = useMutation({
    mutationFn: () =>
      reviewsApi.decide(id, { decision: decision as ReviewDecision, writeback, comment }),
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

  // The server decides whether the "write back" checkbox is even meaningful: an
  // unarmed deployment (WRITEBACK_ENABLED off) would record the toggle as OFF no
  // matter what, so we disable + explain it instead of letting the reviewer tick
  // a box that silently does nothing. REQUEST_CHANGES never writes by design.
  const writebackArmed = data.writeback?.enabled ?? false;
  const requestChanges = decision === 'REQUEST_CHANGES';
  const writebackAllowed = writebackArmed && !requestChanges;

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

      <nav
        role="tablist"
        aria-label="Review detail"
        style={{ display: 'flex', gap: 8, marginTop: 16 }}
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '6px 14px',
                borderRadius: '999px',
                border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: selected ? 'var(--color-accent)' : 'var(--color-surface)',
                color: selected ? '#ffffff' : 'var(--color-text)',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {activeTab === 'review' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 24,
            marginTop: 16,
          }}
        >
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
                  <div
                    style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
                  >
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
                    <AnchorBadge anchor={finding.anchor} />
                  </div>
                  <p
                    style={{
                      margin: '4px 0 0',
                      color: 'var(--color-text-muted)',
                      fontSize: '0.8rem',
                    }}
                  >
                    {finding.anchor.detail}
                  </p>
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
                      maxWidth: '100%',
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
      )}

      {activeTab === 'diff' && (
        <div style={{ marginTop: 16 }}>
          <DiffTab diff={data.diff} findings={findings} />
        </div>
      )}

      {activeTab === 'trace' && (
        <div style={{ marginTop: 16 }}>
          <TraceTab trace={data.trace} />
        </div>
      )}

      {activeTab === 'verification' && (
        <div style={{ marginTop: 16 }} data-testid="verification-tab">
          <p style={{ color: 'var(--color-text-muted)' }}>
            Verification isn't wired into the review flow yet. This tab will show runnable
            reproductions (clone → typecheck → test → evidence) once the sandbox/agent engines are
            built back into ingestion; for now the anchor status on each finding is the honest proxy
            — every claim is still verified against the stored diff, or labeled unverified.
          </p>
        </div>
      )}

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

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={writeback}
                onChange={(event) => setWriteback(event.target.checked)}
                disabled={!writebackAllowed}
                aria-label="Write decision back to PR"
              />
              Write the decision back to the PR
            </label>
            {writeback && writebackAllowed && (
              <textarea
                aria-label="Write-back comment"
                placeholder="Comment to post on the PR (leave blank for a decision summary)"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: 8,
                  borderRadius: 6,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  font: 'inherit',
                  resize: 'vertical',
                }}
              />
            )}
            <p style={{ margin: 0, color: 'var(--color-text-faint)', fontSize: '0.75rem' }}>
              {!writebackArmed
                ? 'Write-back is not armed on this deployment (WRITEBACK_ENABLED is off). This ' +
                  'decision will still be recorded, but nothing will be posted to the PR until an ' +
                  'operator sets WRITEBACK_ENABLED=1 and the per-provider WRITEBACK_<PROVIDER> for ' +
                  'this host.'
                : requestChanges
                  ? 'REQUEST_CHANGES is recorded for audit but never writes back to the PR.'
                  : 'APPROVE posts a comment + success status; REJECT posts a comment + failure status.'}
            </p>
          </div>
        </form>

        {data.decisions.length > 0 && (
          <div
            data-testid="decision-audit"
            style={{ marginTop: 12, fontSize: '0.82rem', color: 'var(--color-text-muted)' }}
          >
            {data.decisions.map((record) => (
              <div key={record.id} style={{ marginBottom: 2 }}>
                <strong>{record.decision}</strong>
                {record.rationale !== null && ` — ${record.rationale}`}
                {' · '}
                {new Date(record.createdAt).toLocaleString()}
                {' · '}
                {record.writebackEnabled ? 'write-back ON' : 'write-back OFF'}
              </div>
            ))}
            {data.writebacks.map((record) => (
              <div key={record.id} style={{ marginLeft: 16 }}>
                {record.provider}/{record.action}: {record.status}
                {record.error !== null && ` — ${record.error}`}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
