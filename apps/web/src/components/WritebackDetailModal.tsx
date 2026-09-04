import type { WritebackRecord } from '../api/reviews';

function StatusBadge({ status }: { readonly status: string }): JSX.Element {
  const styles: Record<string, { bg: string; text: string }> = {
    PENDING: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning)' },
    SUCCEEDED: { bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
    FAILED: { bg: 'var(--color-danger-bg)', text: 'var(--color-danger)' },
    DUPLICATE: { bg: 'var(--color-bg)', text: 'var(--color-text-muted)' },
  };
  const style = styles[status] ?? { bg: 'var(--color-bg)', text: 'var(--color-text-muted)' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '0.65rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
        background: style.bg,
        color: style.text,
      }}
    >
      {status}
    </span>
  );
}

function ActionBadge({ action }: { readonly action: string }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '0.65rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
        background: 'var(--color-info-bg)',
        color: 'var(--color-info)',
      }}
    >
      {action}
    </span>
  );
}

function ProviderBadge({ provider }: { readonly provider: string }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '0.65rem',
        fontWeight: 600,
        background: 'var(--color-purple-bg)',
        color: 'var(--color-purple)',
      }}
    >
      {provider}
    </span>
  );
}

interface WritebackDetailModalProps {
  readonly record: WritebackRecord | null;
  readonly onClose: () => void;
}

export function WritebackDetailModal({ record, onClose }: WritebackDetailModalProps): JSX.Element | null {
  if (!record) return null;

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 1000,
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="writeback-modal-title"
    >
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '85vh',
          overflow: 'auto',
          background: 'var(--color-surface)',
          borderRadius: 12,
          border: '1px solid var(--color-border)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          animation: 'slideUp 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface-2)',
            borderRadius: '12px 12px 0 0',
          }}
        >
          <h3 id="writeback-modal-title" style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
            Write-back Detail
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              color: 'var(--color-text-muted)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px' }}>
          {/* Status & Basic Info */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            <StatusBadge status={record.status} />
            <ActionBadge action={record.action} />
            <ProviderBadge provider={record.provider} />
          </div>

          {/* Fields Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.7rem',
                  color: 'var(--color-text-muted)',
                  marginBottom: 4,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                ID
              </label>
              <code style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{record.id}</code>
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.7rem',
                  color: 'var(--color-text-muted)',
                  marginBottom: 4,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                External Reference
              </label>
              {record.externalRef ? (
                <a
                  href={record.externalRef}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '0.8rem', color: 'var(--color-info)', wordBreak: 'break-all' }}
                >
                  {record.externalRef}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ display: 'inline-block', marginLeft: 4, verticalAlign: 'middle' }}
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-faint)' }}>—</span>
              )}
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.7rem',
                  color: 'var(--color-text-muted)',
                  marginBottom: 4,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Target
              </label>
              <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                {record.provider}/{record.action}
              </span>
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.7rem',
                  color: 'var(--color-text-muted)',
                  marginBottom: 4,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Created
              </label>
              <span style={{ fontSize: '0.8rem' }}>{new Date(record.createdAt).toLocaleString()}</span>
            </div>
            {record.decisionId && (
              <div style={{ gridColumn: 'span 2' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.7rem',
                    color: 'var(--color-text-muted)',
                    marginBottom: 4,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Decision ID
                </label>
                <code style={{ fontSize: '0.8rem' }}>{record.decisionId}</code>
              </div>
            )}
          </div>

          {/* Error Details */}
          {record.error && record.error.length > 0 && (
            <div
              style={{
                background: 'var(--color-danger-bg)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 20,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-danger)"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <strong style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>Error Details</strong>
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--color-danger)',
                }}
              >
                {record.error}
              </pre>
            </div>
          )}

          {/* Raw JSON (for debugging) */}
          <details style={{ marginTop: 16 }}>
            <summary
              style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: 8 }}
            >
              Show raw JSON
            </summary>
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: 'var(--color-bg)',
                borderRadius: 6,
                border: '1px solid var(--color-border)',
                fontSize: '0.7rem',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 300,
                overflow: 'auto',
                color: 'var(--color-text)',
              }}
            >
              {JSON.stringify(record, null, 2)}
            </pre>
          </details>
        </div>
      </div>

      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
    </div>
  );
}
