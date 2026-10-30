import { Link } from 'react-router-dom';
import type { ReviewFinding } from '../../api/reviews';
import { ArrowLeft, CheckCircle2, ExternalLink } from '../Icons';

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** `125000` → `"2m 5s"`; sub-minute stays seconds-only. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown duration';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

interface ReportHeaderProps {
  prTitle: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  aiProvider: string;
  model: string;
  createdAt: string;
  completedAt: string | null;
  /** The finding currently under investigation, shown in the "Investigating" chip. */
  selectedFinding: ReviewFinding | null;
}

/** Review context — the back link, the "Investigating" chip, PR title and meta line. */
export function ReportHeader({
  prTitle,
  repo,
  prNumber,
  prUrl,
  aiProvider,
  model,
  createdAt,
  completedAt,
  selectedFinding,
}: ReportHeaderProps): JSX.Element {
  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <Link
          to="/review"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--color-text-muted)',
            textDecoration: 'none',
            fontSize: '0.78rem',
            fontWeight: 500,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          <ArrowLeft size={13} />
          Back to Queue
        </Link>

        {selectedFinding !== null && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 12px',
              borderRadius: '999px',
              background: 'var(--color-danger-bg)',
              border: '1px solid rgba(239,68,68,0.3)',
              fontSize: '0.76rem',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: 'relative',
                display: 'inline-flex',
                width: 8,
                height: 8,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  background: 'var(--color-danger)',
                  opacity: 0.6,
                  animation: 'hai-ping 1.4s cubic-bezier(0,0,0.2,1) infinite',
                }}
              />
              <span
                style={{
                  position: 'relative',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--color-danger)',
                }}
              />
            </span>
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>Investigating</span>
            <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
              {selectedFinding.file}
              {selectedFinding.line !== null ? `:${selectedFinding.line}` : ''}
            </span>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h1
          style={{
            margin: 0,
            fontSize: '1.4rem',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            lineHeight: 1.25,
          }}
        >
          {prTitle}
        </h1>
        <p
          style={{
            margin: 0,
            color: 'var(--color-text-muted)',
            fontSize: '0.83rem',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--color-info)',
              textDecoration: 'none',
            }}
          >
            <span>
              {repo} · PR #{prNumber}
            </span>
            <ExternalLink size={12} />
          </a>
          <span style={{ color: 'var(--color-text-faint)' }}>·</span>
          <span>
            {aiProvider}/{model}
          </span>
          {completedAt !== null && (
            <>
              <span style={{ color: 'var(--color-text-faint)' }}>·</span>
              <span
                title={`Started ${formatDateTime(createdAt)}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <CheckCircle2 size={12} /> Completed {formatDateTime(completedAt)} · took{' '}
                {formatDuration(new Date(completedAt).getTime() - new Date(createdAt).getTime())}
              </span>
            </>
          )}
        </p>
      </div>
    </header>
  );
}
