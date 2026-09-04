import type { PullRequestCommit, PullRequestCheckStatus, PullRequestCheck } from '../api/reviews';

function CheckStatusBadge({ state }: { readonly state: PullRequestCheckStatus['state'] }): JSX.Element {
  const styles: Record<PullRequestCheckStatus['state'], { bg: string; text: string; label: string }> = {
    success: { bg: 'var(--color-success-bg)', text: 'var(--color-success)', label: 'Passing' },
    failure: { bg: 'var(--color-danger-bg)', text: 'var(--color-danger)', label: 'Failing' },
    pending: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning)', label: 'Pending' },
    error: { bg: 'var(--color-danger-bg)', text: 'var(--color-danger)', label: 'Error' },
    neutral: { bg: 'var(--color-bg)', text: 'var(--color-text-muted)', label: 'No checks' },
  };
  const style = styles[state] ?? styles.neutral;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '0.7rem',
        fontWeight: 600,
        background: style.bg,
        color: style.text,
      }}
    >
      {style.label}
    </span>
  );
}

function CheckItem({ check }: { readonly check: PullRequestCheck }): JSX.Element {
  const statusColors: Record<PullRequestCheck['status'], string> = {
    success: 'var(--color-success)',
    failure: 'var(--color-danger)',
    error: 'var(--color-danger)',
    pending: 'var(--color-warning)',
    neutral: 'var(--color-text-muted)',
    skipped: 'var(--color-text-faint)',
    cancelled: 'var(--color-text-faint)',
    timed_out: 'var(--color-warning)',
    action_required: 'var(--color-danger)',
  };
  const color = statusColors[check.status] ?? 'var(--color-text-muted)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 6,
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        fontSize: '0.78rem',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      <a
        href={check.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'var(--color-text)',
          textDecoration: 'none',
          flex: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {check.name}
      </a>
      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>
        {check.startedAt && check.completedAt
          ? `${Math.round((new Date(check.completedAt).getTime() - new Date(check.startedAt).getTime()) / 1000)}s`
          : check.startedAt
            ? 'running…'
            : '—'}
      </span>
    </div>
  );
}

export function PRMetadataPanel({
  commits,
  checkStatus,
}: {
  readonly commits?: readonly PullRequestCommit[];
  readonly checkStatus?: PullRequestCheckStatus;
}): JSX.Element | null {
  const hasCommits = commits !== undefined && commits.length > 0;
  const hasChecks = checkStatus !== undefined && checkStatus.checks.length > 0;

  if (!hasCommits && !hasChecks) {
    return null;
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
      {hasChecks && (
        <div style={{ marginBottom: hasCommits ? 16 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <h4 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600 }}>CI / Checks</h4>
            <CheckStatusBadge state={checkStatus!.state} />
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {checkStatus!.passedCount}/{checkStatus!.totalCount} passed
              {checkStatus!.failedCount > 0 && ` · ${checkStatus!.failedCount} failed`}
              {checkStatus!.pendingCount > 0 && ` · ${checkStatus!.pendingCount} pending`}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflow: 'auto' }}>
            {checkStatus!.checks.map((check) => (
              <CheckItem key={check.name} check={check} />
            ))}
          </div>
        </div>
      )}

      {hasCommits && (
        <div>
          <h4 style={{ margin: '0 0 8px', fontSize: '0.8rem', fontWeight: 600 }}>Commits ({commits!.length})</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflow: 'auto' }}>
            {commits!.map((commit) => (
              <a
                key={commit.sha}
                href={commit.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  fontSize: '0.78rem',
                  color: 'var(--color-text)',
                  textDecoration: 'none',
                }}
              >
                <code
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-bg)',
                    padding: '1px 4px',
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                >
                  {commit.sha.slice(0, 7)}
                </code>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontWeight: 500,
                      marginBottom: 2,
                    }}
                  >
                    {commit.message}
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                    <span>{commit.author}</span>
                    <span>{new Date(commit.authorDate).toLocaleString()}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
