import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  reviewsApi,
  type ReviewDecision,
  type ReviewFinding,
  type TriageRuleId,
} from '../api/reviews';
import { BreakdownTab } from '../components/BreakdownTab';
import { DiffTab } from '../components/DiffTab';
import { ReportStats } from '../components/ReportStats';
import { ReviewTab } from '../components/ReviewTab';
import { Skeleton, SkeletonLines } from '../components/Skeleton';
import { SummaryMetricsPanel } from '../components/SummaryMetricsPanel';
import { TraceTab } from '../components/TraceTab';
import { VerificationTab } from '../components/VerificationTab';
import { severityColor, sortFindingsBySeverity } from '../components/severity';
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Sliders,
  Zap,
} from '../components/Icons';

/**
 * AI review report page (review-reorient Phase 3) — the human-in-the-loop read
 * surface. A focused workspace in four parts, top to bottom:
 *
 *   1. Review context — the PR title / repo / provider, compact.
 *   2. AI review overview — verdict + "how much attention?" hero + severity split.
 *   3. Five investigation tabs (Review / Breakdown / Diff / AI trace /
 *      Verification), each a different lens on the same review.
 *   4. A sticky human-decision bar — the workflow's final, and only, gate.
 *
 * The selected finding is lifted here and shared across tabs, so the question
 * "which finding am I investigating?" stays answered as the reviewer moves from
 * findings → diff → trace → verification → decision.
 */

type ReviewTabKey = 'review' | 'breakdown' | 'diff' | 'trace' | 'verification';

const TABS: readonly { key: ReviewTabKey; label: string }[] = [
  { key: 'review', label: 'Review' },
  { key: 'breakdown', label: 'Breakdown' },
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

/** Per-rule copy for the triage banner; `{verdict}` is filled with the raw AI verdict. */
const TRIAGE_META: Record<
  TriageRuleId,
  { icon: typeof ShieldAlert; color: string; message: string }
> = {
  'security-block': {
    icon: ShieldAlert,
    color: 'var(--color-danger)',
    message:
      'Security rule fired — a CRITICAL finding in an auth/secrets path downgrades the ' +
      'recommendation to Request changes (the AI’s own verdict was {verdict}).',
  },
  'performance-regression': {
    icon: Zap,
    color: 'var(--color-warning)',
    message:
      'Performance rule fired — possible regression risk: MAJOR+ findings in production code ' +
      'with a low-confidence shadow-judge run.',
  },
  'schema-integrity': {
    icon: Sliders,
    color: 'var(--color-info)',
    message:
      'Schema rule fired — this PR touches migration/schema files; write-back will post only on ' +
      'an explicit APPROVE.',
  },
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
  const block = { borderRadius: 12 } as const;
  const twoCol = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginTop: 16,
  } as const;
  return (
    <main
      role="status"
      aria-label="Loading review report"
      style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 16px 112px' }}
    >
      {/* back link */}
      <Skeleton width={116} height={30} style={{ borderRadius: 8 }} />

      {/* PR title + meta line */}
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <Skeleton width="62%" height={26} />
        <Skeleton width="38%" height={13} />
      </div>

      {/* verdict / attention hero */}
      <Skeleton height={180} style={{ ...block, marginTop: 18 }} />

      {/* summary + metrics visualization */}
      <div style={twoCol}>
        <Skeleton height={144} style={block} />
        <Skeleton height={144} style={block} />
      </div>

      {/* investigation tabs */}
      <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
        {['Review', 'Breakdown', 'Diff', 'AI trace', 'Verification'].map((label, index) => (
          <Skeleton
            key={label}
            height={32}
            style={{ borderRadius: 8, width: [72, 98, 64, 82, 104][index] }}
          />
        ))}
      </div>

      {/* findings list + detail pane */}
      <div style={twoCol}>
        <div style={{ display: 'grid', gap: 8 }}>
          <SkeletonLines count={5} />
        </div>
        <Skeleton height={180} style={block} />
      </div>
    </main>
  );
}

/** How often to poll for an in-progress report (ms). */
const PENDING_POLL_MS = 3_000;

export default function ReviewReportPage(): JSX.Element {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [writeback, setWriteback] = useState(true);
  const [comment, setComment] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReviewTabKey>('review');
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['reviewReport', id],
    queryFn: () => reviewsApi.getReport(id),
    enabled: id !== '',
    refetchInterval: (query) => {
      const d = query.state.data;
      // Poll while the review is still being processed (not yet complete).
      if (!d || d.reviewStatus === 'complete' || d.reviewStatus === 'error') {
        return false;
      }
      return PENDING_POLL_MS;
    },
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
    return (
      <main style={{ maxWidth: 1120, margin: '0 auto', padding: 16 }}>
        <div className="rq-empty" role="alert">
          <div className="rq-empty-icon">
            <AlertTriangle />
          </div>
          <h3 className="rq-empty-title">Couldn&rsquo;t load this review report</h3>
          <p className="rq-empty-text">
            {error instanceof Error
              ? error.message
              : 'The report failed to load — it may have been deleted, or the review service is unreachable.'}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Link to="/review" className="rq-empty-reset">
              <ArrowLeft size={13} />
              Back to Queue
            </Link>
            <button type="button" className="rq-empty-reset" onClick={() => void refetch()}>
              <RefreshCw size={13} />
              Retry
            </button>
          </div>
        </div>
      </main>
    );
  }

  // While the background worker is still processing, show a progressive status
  // with current stage, batch progress, and any findings already inserted.
  const isPending = data.reviewStatus !== 'complete' && data.reviewStatus !== 'error';
  if (isPending || data.reviewStatus === 'error') {
    // Human-readable labels for each stage.
    const STATUS_LABEL: Record<string, string> = {
      pending: 'Waiting to start…',
      fetching: '📡 Fetching pull request from GitHub…',
      recalling: '🧠 Recalling past review context…',
      reviewing: '🤖 Reviewing code…',
      storing: '💾 Storing results…',
      complete: '✅ Complete',
      error: '❌ Review failed',
    };

    // Pipeline stage order for progress calculation
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

    // Human-readable stage names for the pipeline indicator
    const STAGE_NAMES: Record<string, string> = {
      pending: 'Pending',
      fetching: 'Fetching PR',
      recalling: 'Recalling',
      reviewing: 'Reviewing',
      storing: 'Storing',
    };

    return (
      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 16px 112px' }}>
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
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
            {data.prTitle}
          </h1>
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
              }}
            >
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
              <button type="button" className="btn btn-ghost" onClick={() => void refetch()}>
                <RefreshCw size={13} />
                Retry
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
                        {isPast ? '✓' : i + 1}
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
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {data.reviewStatus !== 'storing' ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : (
                    <span style={{ fontSize: 20 }} aria-hidden="true">
                      💾
                    </span>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{label}</span>
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
          </section>
        )}
      </main>
    );
  }

  const findings = sortFindingsBySeverity(data.findings);
  // Default the "currently investigating" focus to the worst finding until the
  // reviewer selects one explicitly; the selection then survives tab switches.
  const activeFindingId = selectedFindingId ?? findings[0]?.id ?? null;
  const selectedFinding = findings.find((finding) => finding.id === activeFindingId) ?? null;

  // The server decides whether the "write back" checkbox is even meaningful: a
  // write-back-disabled deployment (WRITEBACK_ENABLED=0) records the toggle as OFF
  // no matter what, so we disable + explain it instead of letting the reviewer tick
  // a box that silently does nothing. REQUEST_CHANGES never writes by design.
  const writebackArmed = data.writeback?.enabled ?? false;
  const requestChanges = decision === 'REQUEST_CHANGES';
  const writebackAllowed = writebackArmed && !requestChanges;

  const selectFinding = (findingId: string): void => setSelectedFindingId(findingId);
  const openInDiff = (finding: ReviewFinding): void => {
    setSelectedFindingId(finding.id);
    setActiveTab('diff');
  };
  const openInVerification = (finding: ReviewFinding): void => {
    setSelectedFindingId(finding.id);
    setActiveTab('verification');
  };
  const openInReview = (findingId: string): void => {
    setSelectedFindingId(findingId);
    setActiveTab('review');
  };

  const tabBadge = (tab: ReviewTabKey): string | number | undefined => {
    switch (tab) {
      case 'review':
        return data.findings.length;
      case 'diff':
        return data.diff.length;
      case 'trace':
        return data.trace.calls.length;
      case 'verification': {
        const v = data.verification;
        if (v === null || v === undefined) {
          return undefined;
        }
        if (v.status === 'PASSED') {
          return '✓';
        }
        if (v.status === 'FAILED' || v.status === 'ERROR') {
          return '✕';
        }
        return '·';
      }
      default:
        return undefined;
    }
  };

  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 16px 112px' }}>
      {/* 1 — review context */}
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
                background: '#160d11',
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
                    background: '#f87171',
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
                    background: '#ef4444',
                  }}
                />
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                Investigating
              </span>
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
            {data.prTitle}
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
              href={data.prUrl}
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
                {data.repo} · PR #{data.prNumber}
              </span>
              <ExternalLink size={12} />
            </a>
            <span style={{ color: 'var(--color-text-faint)' }}>·</span>
            <span>
              {data.aiProvider}/{data.model}
            </span>
          </p>
        </div>
      </header>

      {/* 1b — triage rule flags, if any fired */}
      {data.triage.matchedRules.length > 0 && (
        <section
          role="note"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            margin: '0 0 12px',
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          {data.triage.matchedRules.map((rule) => {
            const meta = TRIAGE_META[rule];
            const Icon = meta.icon;
            return (
              <div
                key={rule}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  color: 'var(--color-text-muted)',
                  fontSize: '0.82rem',
                  lineHeight: 1.4,
                }}
              >
                <span style={{ color: meta.color, display: 'inline-flex', marginTop: 1 }}>
                  <Icon size={15} />
                </span>
                <span>{meta.message.replace('{verdict}', data.overallVerdict)}</span>
              </div>
            );
          })}
        </section>
      )}

      {/* 2 — AI review overview */}
      <ReportStats stats={data.stats} overallVerdict={data.overallVerdict} />

      {/* 2b — summary & architectural impact + metrics visualization */}
      <SummaryMetricsPanel summary={data.summary} stats={data.stats} findings={findings} />

      {/* 3 — investigation tabs */}
      <nav
        role="tablist"
        aria-label="Review detail"
        className="review-tabs"
        style={{ marginTop: 20 }}
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab.key;
          const badge = tabBadge(tab.key);
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.key)}
              className={`review-tab${selected ? ' review-tab-active' : ''}`}
            >
              {tab.label}
              {badge !== undefined && <span className="review-tab-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="review-tab-panel" key={activeTab}>
        {activeTab === 'review' && (
          <ReviewTab
            findings={findings}
            suggestions={data.suggestions}
            selectedFindingId={activeFindingId}
            onSelect={selectFinding}
            onOpenInDiff={openInDiff}
            onOpenVerification={openInVerification}
          />
        )}

        {activeTab === 'breakdown' && (
          <div style={{ marginTop: 16 }}>
            <BreakdownTab stats={data.stats} />
          </div>
        )}

        {activeTab === 'diff' && (
          <DiffTab
            diff={data.diff}
            findings={findings}
            selectedFindingId={activeFindingId}
            onSelectFinding={selectFinding}
          />
        )}

        {activeTab === 'trace' && (
          <TraceTab
            trace={data.trace}
            createdAt={data.createdAt}
            stats={data.stats}
            findings={findings}
            overallVerdict={data.overallVerdict}
          />
        )}

        {activeTab === 'verification' && (
          <VerificationTab
            verification={data.verification}
            findings={findings}
            selectedFindingId={activeFindingId}
            onSelectFinding={selectFinding}
            onOpenReview={openInReview}
          />
        )}
      </div>

      {/* 4 — human decision */}
      <section className="decision-bar">
        <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Your decision</h3>
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
          <div role="radiogroup" aria-label="Decision" className="decision-options">
            {(Object.keys(DECISION_LABEL) as ReviewDecision[]).map((choice) => {
              const selected = decision === choice;
              const tone = DECISION_TONE[choice];
              return (
                <label
                  key={choice}
                  className={`decision-option${selected ? ' decision-option-selected' : ''}`}
                  style={selected ? { background: tone, borderColor: tone } : undefined}
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
              className={decision === null ? 'btn btn-ghost' : 'btn btn-primary'}
              style={{ marginLeft: 'auto' }}
            >
              {decide.isPending ? 'Submitting…' : 'Submit decision'}
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
                  boxSizing: 'border-box',
                }}
              />
            )}
            <p style={{ margin: 0, color: 'var(--color-text-faint)', fontSize: '0.75rem' }}>
              {!writebackArmed
                ? 'Write-back is disabled on this deployment (WRITEBACK_ENABLED=0 is set). This ' +
                  'decision will still be recorded, but nothing will be posted to the PR until an ' +
                  'operator removes that override (or sets WRITEBACK_ENABLED=1), with the ' +
                  'per-provider WRITEBACK_<PROVIDER> left armed.'
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
