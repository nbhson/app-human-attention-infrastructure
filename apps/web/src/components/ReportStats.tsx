import type { CSSProperties } from 'react';
import type { ReviewStats } from '../api/reviews';
import { SEVERITIES, severityColor, severityLabel } from './severity';

/**
 * AI review overview (review-reorient Phase 3) — the single glanceable answer to
 * "how serious is this, and how much of my attention does it need?" Visual
 * hierarchy is deliberate, strongest first:
 *
 *   1. Verdict — the AI's recommendation, plus a one-line "so what".
 *   2. Human attention required — the share of hand-written files carrying an
 *      actionable finding, stated as load ("N of M files need inspection") with a
 *      progress bar, never as a bare KPI.
 *   3. Findings by severity — the Critical / Major / Minor split with a legend.
 *   4. Supporting statistics — diff size, de-emphasised so it can't crowd the
 *      headline.
 */

type Verdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

const VERDICT_STYLE: Record<Verdict, { color: string; label: string; note: string }> = {
  APPROVE: {
    color: 'var(--verdict-approve)',
    label: 'Approve',
    note: 'The AI found no blocking issues — nothing needs your attention before merge.',
  },
  REQUEST_CHANGES: {
    color: 'var(--verdict-request-changes)',
    label: 'Request changes',
    note: 'The AI found issues that need your attention before this should merge.',
  },
  COMMENT: {
    color: 'var(--verdict-comment)',
    label: 'Comment',
    note: 'The AI left comments but did not block the change.',
  },
};

function pct(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%';
}

const EYEBROW: CSSProperties = {
  color: 'var(--color-text-faint)',
  fontSize: '0.72rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const TILE_STYLE: CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: '6px 12px',
  minWidth: 0,
};

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div style={TILE_STYLE}>
      <div style={{ color: 'var(--color-text-faint)', fontSize: '0.72rem' }}>{label}</div>
      <div
        style={{
          fontSize: '0.95rem',
          fontWeight: 600,
          color: tone ?? 'var(--color-text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function ReportStats({
  stats,
  overallVerdict,
}: {
  readonly stats: ReviewStats | undefined;
  readonly overallVerdict: Verdict;
}): JSX.Element {
  // The backend may serve a report whose derived statistics block is missing
  // (e.g. a report written before the stats reduction landed). Degrade to a
  // notice rather than white-screening the whole page on `stats.attentionShare`.
  if (stats === undefined) {
    return (
      <section
        data-testid="report-stats"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-4)',
          background: 'var(--color-surface-2)',
          marginTop: 'var(--space-3)',
        }}
      >
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Statistics are unavailable for this report.</p>
      </section>
    );
  }

  const attentionPct = Math.round(stats.attentionShare * 100);
  const verdict = VERDICT_STYLE[overallVerdict] ?? VERDICT_STYLE.COMMENT;

  const severityRows = SEVERITIES.map((band) => ({
    band,
    count: stats.severity[band] ?? 0,
  }));
  const nonZero = severityRows.filter((row) => row.count > 0);

  return (
    <section
      data-testid="report-stats"
      style={{
        border: '1px solid var(--color-border)',
        borderTop: `3px solid ${verdict.color}`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        background: 'var(--color-surface-2)',
        display: 'grid',
        gap: 'var(--space-4)',
        marginTop: 'var(--space-3)',
      }}
    >
      {/* 1 + 2 — verdict and the attention required hero */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        <div>
          <div style={EYEBROW}>Verdict</div>
          <span
            data-testid="verdict-badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginTop: 'var(--space-2)',
              padding: '5px 14px',
              borderRadius: 'var(--radius)',
              background: verdict.color,
              color: 'var(--color-on-accent)',
              fontWeight: 700,
              fontSize: '0.9rem',
              letterSpacing: '0.01em',
            }}
          >
            {verdict.label}
          </span>
          <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--color-text-muted)' }}>{verdict.note}</p>
        </div>

        <div>
          <div style={EYEBROW}>Human attention required</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
            <span
              data-testid="attention-pct"
              style={{
                fontSize: '1.9rem',
                fontWeight: 700,
                color: 'var(--attention)',
                lineHeight: 1.1,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {attentionPct}%
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>
              <strong style={{ color: 'var(--color-text)' }}>
                {stats.flaggedFiles} of {stats.totalFiles} files
              </strong>{' '}
              need inspection
            </span>
          </div>
          <div
            role="img"
            aria-label={`${attentionPct}% of hand-written files have actionable findings`}
            style={{
              marginTop: 'var(--space-3)',
              height: 8,
              borderRadius: '999px',
              background: 'var(--color-border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${attentionPct}%`,
                height: '100%',
                background: 'var(--attention)',
                borderRadius: '999px',
              }}
            />
          </div>
          <div
            style={{
              marginTop: 'var(--space-1)',
              color: 'var(--color-text-faint)',
              fontSize: '0.78rem',
            }}
          >
            CRITICAL · MAJOR · MINOR findings only — NIT and INFO don&apos;t count
          </div>
        </div>
      </div>

      {/* 3 — findings by severity */}
      <div>
        <div style={{ ...EYEBROW, marginBottom: 'var(--space-2)' }}>Findings by severity</div>

        <div
          data-testid="severity-bar"
          style={{
            display: 'flex',
            gap: 2,
            height: 12,
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
            background: 'var(--color-border)',
          }}
        >
          {stats.findingTotal === 0 && <div style={{ flex: 1, background: 'var(--color-surface)' }} />}
          {nonZero.map((row) => (
            <div
              key={row.band}
              data-testid={`severity-segment-${row.band}`}
              style={{
                flexGrow: row.count,
                flexBasis: 0,
                background: severityColor(row.band),
              }}
            />
          ))}
        </div>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 'var(--space-2) 0 0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 18px',
          }}
        >
          {severityRows.map((row) => (
            <li
              key={row.band}
              data-testid={`severity-${row.band}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.82rem',
                opacity: row.count > 0 ? 1 : 0.45,
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: severityColor(row.band),
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--color-text)' }}>{severityLabel(row.band)}</span>
              <span
                style={{
                  color: 'var(--color-text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {row.count} ({pct(row.count, stats.findingTotal)})
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 4 — supporting statistics, de-emphasised */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))',
          gap: 'var(--space-2)',
        }}
      >
        <Tile label="Files" value={String(stats.totalFiles)} />
        <Tile label="Added" value={`+${stats.addedLines}`} tone="var(--color-success)" />
        <Tile label="Removed" value={`−${stats.removedLines}`} tone="var(--color-danger)" />
        <Tile label="Changed" value={String(stats.changedLines)} />
      </div>
    </section>
  );
}
