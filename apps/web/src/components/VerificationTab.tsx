import type { ReviewFinding, ReviewVerification, ReviewVerificationStatus } from '../api/reviews';

/**
 * Verification tab (trust loop) — "what still needs human validation?" Two
 * layers:
 *
 *   1. Per-finding trust: the checks we can honestly derive from the stored
 *      report — whether the finding's `file:line` anchored in the diff (evidence
 *      exists) and whether a fix is suggested. A finding that is *not* anchored
 *      may be hallucinated, so it is flagged as needing human validation.
 *      There is deliberately no "requirement relevance" row: no requirement
 *      context is stored per finding, so we do not invent one.
 *   2. Machine verification (wedge #1): the PR cloned at its head SHA and its own
 *      `build`/`test` run in the Docker sandbox. A FAILED run is evidence you
 *      weigh next to the findings — never a gate on your decision.
 */

/** Status → glanceable tone (theme tokens, so it follows dark mode). */
const TONE: Record<
  ReviewVerificationStatus,
  { readonly icon: string; readonly label: string; readonly color: string }
> = {
  PENDING: { icon: '◷', label: 'pending', color: 'var(--color-text-muted)' },
  RUNNING: { icon: '⟳', label: 'running', color: 'var(--color-info)' },
  PASSED: { icon: '✓', label: 'passed', color: 'var(--color-success)' },
  FAILED: { icon: '✕', label: 'failed', color: 'var(--color-danger)' },
  SKIPPED: { icon: '→', label: 'skipped', color: 'var(--color-warning)' },
  ERROR: { icon: '⚠', label: 'error', color: 'var(--color-danger)' },
};

const field = {
  color: 'var(--color-text-faint)',
  fontSize: '0.8rem',
} as const;

const card = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: '8px 12px',
  marginBottom: 8,
  background: 'var(--color-surface-2)',
} as const;

/** Humanize a millisecond duration (or return `—` when unknown). */
function duration(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Humanize a 40-char SHA into a glanceable prefix. */
function shortSha(sha: string | null): string {
  if (sha === null) {
    return '—';
  }
  return sha.slice(0, 12);
}

export function VerificationTab({
  verification,
  findings,
  selectedFindingId,
  onSelectFinding,
  onOpenReview,
}: {
  readonly verification: ReviewVerification | null | undefined;
  readonly findings: readonly ReviewFinding[];
  readonly selectedFindingId: string | null;
  readonly onSelectFinding: (id: string) => void;
  readonly onOpenReview: (id: string) => void;
}): JSX.Element {
  const anchored = findings.filter((finding) => finding.anchor.status === 'verified').length;
  const skipped = verification !== null && verification !== undefined && verification.status === 'SKIPPED';

  return (
    <div data-testid="verification-tab" style={{ marginTop: 16 }}>
      {/* Layer 1 — per-finding trust */}
      {findings.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 6px' }}>Finding trust</h3>
          <p style={{ color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
            {anchored} of {findings.length} findings have their cited <code>file:line</code> anchored in the diff. An
            unanchored finding may point at code the AI never actually saw — it needs your validation.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {findings.map((finding) => {
              const ok = finding.anchor.status === 'verified';
              const hasFix = finding.suggestion !== null;
              const selected = selectedFindingId === finding.id;
              return (
                <li
                  key={finding.id}
                  className="verif-row"
                  style={{
                    background: selected ? 'color-mix(in srgb, var(--color-info) 6%, transparent)' : undefined,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectFinding(finding.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8rem',
                      color: 'var(--color-info)',
                    }}
                  >
                    {finding.file}
                    {finding.line !== null ? `:${finding.line}` : ''}
                  </button>
                  <span className={`finding-flag ${ok ? 'finding-flag-ok' : 'finding-flag-warn'}`}>
                    <span aria-hidden="true">{ok ? '✓' : '⚠'}</span>
                    {ok ? 'Evidence in diff' : 'Unanchored — validate'}
                  </span>
                  <span className={`finding-flag ${hasFix ? 'finding-flag-ok' : 'finding-flag-muted'}`}>
                    <span aria-hidden="true">⚙</span>
                    {hasFix ? 'Fix suggested' : 'No fix'}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenReview(finding.id)}>
                    View in Review →
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Layer 2 — machine build/test verification */}
      {verification === null || verification === undefined ? (
        <section>
          <h3 style={{ margin: '0 0 8px' }}>Machine verification</h3>
          <p style={{ color: 'var(--color-text-muted)' }}>
            No verification run recorded for this report. Verification is opt-in (<code>VERIFY_REVIEW_ENABLED=1</code>):
            when armed, the PR is cloned at its head SHA and its own <code>build</code> then <code>test</code> scripts
            are run in the Docker sandbox (<code>network: none</code>, never the harness process), and the result
            appears here.
          </p>
        </section>
      ) : (
        <section>
          <h3 style={{ margin: '0 0 8px' }}>Machine verification</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span
              data-testid={`verification-${verification.status.toLowerCase()}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '1px 10px',
                borderRadius: '999px',
                border: `1px solid ${TONE[verification.status].color}`,
                color: TONE[verification.status].color,
                fontSize: '0.78rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            >
              <span aria-hidden="true">{TONE[verification.status].icon}</span>
              {TONE[verification.status].label}
            </span>
            {!skipped && (
              <span style={field}>
                overall{' '}
                <strong>
                  {verification.overall === null ? '—' : verification.overall === 'PASSED' ? 'PASSED' : 'FAILED'}
                </strong>
              </span>
            )}
            <span style={field}>
              {skipped ? 'prepared at head' : 'head'} <code>{shortSha(verification.headSha)}</code>
            </span>
            <span style={field}>
              {skipped ? 'prepared in' : 'took'} {duration(verification.durationMs)}
            </span>
          </div>

          {skipped && (
            <p style={{ margin: '12px 0 0', color: 'var(--color-warning)' }}>
              Skipped — nothing ran, so there is no pass/fail result. The head and duration above are the sandbox
              preparation (clone), not a verification outcome.
            </p>
          )}

          {verification.error !== null && verification.error.length > 0 && (
            <p style={{ margin: '12px 0 0', color: 'var(--color-text-muted)' }}>{verification.error}</p>
          )}

          {verification.failedKinds.length > 0 && (
            <section style={{ margin: '12px 0' }}>
              <span style={{ ...field, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Failed kinds</span>{' '}
              <code>{verification.failedKinds.join(', ')}</code>
            </section>
          )}

          {verification.timedOutKinds.length > 0 && (
            <section style={{ marginBottom: 12 }}>
              <span style={{ ...field, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Timed out</span>{' '}
              <code>{verification.timedOutKinds.join(', ')}</code>
            </section>
          )}

          {(verification.failedChecks ?? []).length > 0 && (
            <section>
              <h4 style={{ margin: '0 0 8px' }}>Failed checks</h4>
              {(verification.failedChecks ?? []).map((check, index) => (
                <div key={index} style={card}>
                  <div>
                    <strong>{check.kind}</strong> · {check.status}
                    {check.exitCode !== undefined ? ` · exit ${check.exitCode}` : ''}
                  </div>
                  <pre
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      padding: 8,
                      marginTop: 8,
                      maxWidth: '100%',
                      overflowX: 'auto',
                      whiteSpace: 'pre',
                      fontSize: '0.8rem',
                    }}
                  >
                    {check.tail}
                  </pre>
                </div>
              ))}
            </section>
          )}

          <p
            style={{
              margin: '16px 0 0',
              color: 'var(--color-text-faint)',
              fontSize: '0.75rem',
            }}
          >
            Verification is a flag, not a gate: a FAILED run is evidence you weigh next to the findings, never a blocker
            on your decision or on a write-back.
          </p>
        </section>
      )}
    </div>
  );
}
