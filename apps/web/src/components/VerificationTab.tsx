import type { ReviewVerification, ReviewVerificationStatus } from '../api/reviews';

/**
 * Verification tab (review-reorient Phase 3, wedge #1) — the "run the real code"
 * read surface. The backend clones the PR at its head SHA and runs the clone's own
 * `build` then `test` in the Docker sandbox; this tab shows the honest result. A
 * FAILED flag is information next to the findings, never a gate on the human
 * decision — the reviewer still decides.
 */

/** Status → glanceable tone (theme tokens, so it follows dark mode). */
const TONE: Record<
  ReviewVerificationStatus,
  { readonly icon: string; readonly label: string; readonly color: string }
> = {
  PENDING: { icon: '◷', label: 'pending', color: 'var(--color-text-muted)' },
  RUNNING: { icon: '⟳', label: 'running', color: 'var(--color-accent)' },
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
}: {
  readonly verification: ReviewVerification | null | undefined;
}): JSX.Element {
  // `undefined`/`null` means no run recorded yet: the report may predate this
  // field, or verification is disabled and no row was written. Be explicit about
  // the difference between "no run" and "a run that skipped".
  if (verification === null || verification === undefined) {
    return (
      <div data-testid="verification-tab">
        <p style={{ color: 'var(--color-text-muted)' }}>
          No verification run recorded for this report. Verification is opt-in (
          <code>VERIFY_REVIEW_ENABLED=1</code>): when armed, the PR is cloned at its head SHA and
          its own <code>build</code> then <code>test</code> scripts are run in the Docker sandbox (
          <code>network: none</code>, never the harness process), and the result appears here.
        </p>
      </div>
    );
  }

  const tone = TONE[verification.status];
  const failedChecks = verification.failedChecks ?? [];
  const overall =
    verification.overall === null ? '—' : verification.overall === 'PASSED' ? 'PASSED' : 'FAILED';

  return (
    <div data-testid="verification-tab">
      <section style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span
            data-testid={`verification-${verification.status.toLowerCase()}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '1px 10px',
              borderRadius: '999px',
              border: `1px solid ${tone.color}`,
              color: tone.color,
              fontSize: '0.78rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            <span aria-hidden="true">{tone.icon}</span>
            {tone.label}
          </span>
          <span style={field}>
            overall <strong>{overall}</strong>
          </span>
          <span style={field}>
            head <code>{shortSha(verification.headSha)}</code>
          </span>
          <span style={field}>took {duration(verification.durationMs)}</span>
        </div>

        {verification.error !== null && verification.error.length > 0 && (
          <p style={{ margin: '12px 0 0', color: 'var(--color-text-muted)' }}>
            {verification.error}
          </p>
        )}
      </section>

      {verification.failedKinds.length > 0 && (
        <section style={{ marginBottom: 12 }}>
          <span style={{ ...field, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Failed kinds
          </span>
          <code>{verification.failedKinds.join(', ')}</code>
        </section>
      )}

      {verification.timedOutKinds.length > 0 && (
        <section style={{ marginBottom: 12 }}>
          <span style={{ ...field, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Timed out
          </span>
          <code>{verification.timedOutKinds.join(', ')}</code>
        </section>
      )}

      {failedChecks.length > 0 && (
        <section>
          <h3 style={{ margin: '0 0 8px' }}>Failed checks</h3>
          {failedChecks.map((check, index) => (
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

      <p style={{ margin: '16px 0 0', color: 'var(--color-text-faint)', fontSize: '0.75rem' }}>
        Verification is a flag, not a gate: a FAILED run is evidence you weigh next to the findings,
        never a blocker on your decision or on a write-back.
      </p>
    </div>
  );
}
