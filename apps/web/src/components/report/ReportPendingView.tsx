import { Link } from 'react-router-dom';
import type { ReviewReport } from '../../api/reviews';
import { ArrowLeft, Brain, Bot, Check, CheckCircle2, Database, Radio, RefreshCw, type IconProps, X } from '../Icons';
import { RecalledMemoriesPanel } from '../RecalledMemoriesPanel';
import { severityColor, sortFindingsBySeverity } from '../severity';

interface ReportPendingViewProps {
  data: ReviewReport;
  onRetry: () => void;
  retrying: boolean;
}

/** Human-readable labels for each stage. */
const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting to start…',
  fetching: 'Fetching pull request from GitHub…',
  recalling: 'Recalling past review context…',
  reviewing: 'Reviewing code…',
  storing: 'Storing results…',
  complete: 'Complete',
  error: 'Review failed',
};

/** Pipeline stage → lucide-style icon (replaces the old emoji prefixes). */
const STATUS_ICON: Record<string, (props: IconProps) => JSX.Element> = {
  fetching: Radio,
  recalling: Brain,
  reviewing: Bot,
  storing: Database,
  complete: CheckCircle2,
  error: X,
};

/** The stage's icon, or null when the stage has none (e.g. `pending`). */
function StatusGlyph({ status, size = 14 }: { status: string; size?: number }): JSX.Element | null {
  const Icon = STATUS_ICON[status];
  return Icon !== undefined ? <Icon size={size} /> : null;
}

/** Pipeline stage order for progress calculation */
const STAGE_ORDER: Record<string, number> = {
  pending: 0,
  fetching: 1,
  recalling: 2,
  reviewing: 3,
  storing: 4,
  complete: 5,
  error: 5,
};
const TOTAL_STAGES = 5;

/** Human-readable stage names for the pipeline indicator */
const STAGE_NAMES: Record<string, string> = {
  pending: 'Pending',
  fetching: 'Fetching PR',
  recalling: 'Recalling',
  reviewing: 'Reviewing',
  storing: 'Storing',
};

/**
 * Progressive status shown while the background worker is still processing:
 * current stage, batch progress, and any findings already inserted. Also covers
 * the terminal review-failed state with a retry affordance.
 */
export function ReportPendingView({ data, onRetry, retrying }: ReportPendingViewProps): JSX.Element {
  // Calculate overall progress percentage
  let progressPercent = 0;
  const stageIndex = STAGE_ORDER[data.reviewStatus] ?? 0;
  if (data.reviewStatus === 'error') {
    progressPercent = 0;
  } else if (stageIndex === 0) {
    progressPercent = 2;
  } else if (stageIndex >= TOTAL_STAGES) {
    progressPercent = 100;
  } else {
    // Each stage is roughly (100 / TOTAL_STAGES) % of the total
    const stageWidth = 100 / TOTAL_STAGES;
    // Base = stages before current
    const base = (stageIndex - 1) * stageWidth;
    if (data.reviewStatus === 'reviewing' && data.batchProgress) {
      const { current, total } = data.batchProgress;
      if (total > 0) {
        // Within the reviewing stage, progress is proportional to completed batches
        progressPercent = Math.round(base + (current / total) * stageWidth);
      } else {
        // current=0, total=0 — preparing batches
        progressPercent = Math.round(base + stageWidth * 0.1);
      }
    } else {
      // Other stages: show ~70% progress within the stage
      progressPercent = Math.round(base + stageWidth * 0.7);
    }
  }
  // Clamp to [2, 99] so the bar never looks fully done or stuck at 0
  progressPercent = Math.max(2, Math.min(99, progressPercent));

  // Stage label with visual indicator
  const label = STATUS_LABEL[data.reviewStatus] ?? data.reviewStatus;

  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 16px 0' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
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
            width: 'fit-content',
          }}
        >
          <ArrowLeft size={13} />
          Back to Queue
        </Link>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.01em' }}>{data.prTitle}</h1>
        <p
          style={{
            margin: 0,
            color: 'var(--color-text-muted)',
            fontSize: '0.83rem',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {data.repo} · PR #{data.prNumber}
        </p>
      </header>

      {data.reviewStatus === 'error' ? (
        // Error state
        <section
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            padding: 48,
            textAlign: 'center',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 600,
              color: 'var(--color-danger)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <StatusGlyph status={data.reviewStatus} />
            {label}
          </h2>
          <p
            style={{
              margin: 0,
              color: 'var(--color-text-muted)',
              fontSize: '0.9rem',
              maxWidth: 480,
            }}
          >
            {data.summary}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to="/review" className="btn btn-primary">
              Back to Review Queue
            </Link>
            <button type="button" className="btn btn-ghost" disabled={retrying} onClick={onRetry}>
              <RefreshCw size={13} />
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        </section>
      ) : (
        // In-progress state with pipeline progress bar
        <section
          role="status"
          aria-live="polite"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            padding: 32,
          }}
        >
          {/* Pipeline stage indicator (5 stages visual) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              background: 'var(--color-surface)',
              borderRadius: 12,
              border: '1px solid var(--color-border)',
              padding: '20px 24px',
              overflow: 'hidden',
            }}
          >
            {['pending', 'fetching', 'recalling', 'reviewing', 'storing'].map((stage, i) => {
              const currentStage = STAGE_ORDER[data.reviewStatus] ?? 0;
              const stageNum = STAGE_ORDER[stage] ?? 0;
              const isActive = stageNum === currentStage;
              const isPast = stageNum < currentStage;
              const isFuture = stageNum > currentStage;
              const stageLabel = STAGE_NAMES[stage] ?? stage;

              return (
                <div
                  key={stage}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flex: 1,
                    position: 'relative',
                  }}
                >
                  {/* Stage circle + label */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      position: 'relative',
                      zIndex: 1,
                      width: '100%',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        background: isPast
                          ? 'var(--color-success)'
                          : isActive
                            ? 'var(--color-info)'
                            : 'var(--color-bg)',
                        color: isPast || isActive ? '#fff' : 'var(--color-text-faint)',
                        border: isFuture ? '2px solid var(--color-border)' : 'none',
                        transition: 'background 0.3s, color 0.3s',
                      }}
                    >
                      {isPast ? <Check size={14} /> : i + 1}
                    </div>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: isActive ? 600 : 400,
                        color: isPast
                          ? 'var(--color-success)'
                          : isActive
                            ? 'var(--color-text)'
                            : 'var(--color-text-faint)',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {stageLabel}
                    </span>
                  </div>

                  {/* Connector line to next stage */}
                  {i < 4 && (
                    <div
                      style={{
                        flex: 1,
                        height: 2,
                        background: isPast ? 'var(--color-success)' : 'var(--color-border)',
                        marginTop: -22,
                        transition: 'background 0.3s',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Current status + progress bar */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: '16px 20px',
              borderRadius: 12,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            {/* Status text */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {data.reviewStatus !== 'storing' ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Database size={18} />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: '0.95rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <StatusGlyph status={data.reviewStatus} />
                    {label}
                  </span>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                    {data.reviewStatus === 'reviewing' && data.batchProgress
                      ? data.batchProgress.total > 0
                        ? `Batch ${data.batchProgress.current} of ${data.batchProgress.total}`
                        : 'Preparing files and splitting into batches…'
                      : 'This page updates automatically.'}
                  </span>
                </div>
              </div>
              {/* Percentage badge */}
              <div
                style={{
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--color-info)',
                }}
              >
                {progressPercent}%
              </div>
            </div>

            {/* Progress bar */}
            <div
              style={{
                width: '100%',
                height: 6,
                borderRadius: 3,
                background: 'var(--color-bg)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  borderRadius: 3,
                  background: 'linear-gradient(90deg, var(--color-info), var(--color-success))',
                  transition: 'width 0.5s ease-in-out',
                }}
              />
            </div>
          </div>

          {/* Progressive findings — show partial results as they arrive */}
          {data.findings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>
                Findings so far ({data.findings.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortFindingsBySeverity(data.findings)
                  .slice(0, 20)
                  .map((finding) => (
                    <div
                      key={finding.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        fontSize: '0.82rem',
                      }}
                    >
                      <span
                        style={{
                          color: severityColor(finding.severity),
                          fontWeight: 700,
                          fontSize: '0.72rem',
                          textTransform: 'uppercase',
                          minWidth: 48,
                        }}
                      >
                        {finding.severity}
                      </span>
                      <span
                        style={{
                          color: 'var(--color-text-muted)',
                          minWidth: 120,
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.76rem',
                        }}
                      >
                        {finding.file}
                        {finding.line !== null ? `:${finding.line}` : ''}
                      </span>
                      <span>{finding.message}</span>
                    </div>
                  ))}
                {data.findings.length > 20 && (
                  <p
                    style={{
                      margin: 0,
                      color: 'var(--color-text-faint)',
                      fontSize: '0.8rem',
                      textAlign: 'center',
                    }}
                  >
                    … and {data.findings.length - 20} more
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Recalled memories — show during "recalling" stage */}
          {data.reviewStatus === 'recalling' && data.recalledMemories && data.recalledMemories.length > 0 && (
            <RecalledMemoriesPanel memories={data.recalledMemories} />
          )}
        </section>
      )}
    </main>
  );
}
