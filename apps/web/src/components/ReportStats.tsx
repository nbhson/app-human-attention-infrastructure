import type { CSSProperties } from 'react';
import type { ReviewStats } from '../api/reviews';
import { SEVERITIES, severityColor, severityLabel } from './severity';

/**
 * Report dashboard (review-reorient Phase 3) — the glanceable answer to "did the
 * AI actually save me time?" Three things, top to bottom:
 *
 *  1. A verdict badge (APPROVE / REQUEST_CHANGES / COMMENT) in the verdict's
 *     status colour.
 *  2. An attention hero: the share of the PR's added lines that live in files
 *     carrying an actionable finding (CRITICAL/MAJOR/MINOR) — the product's
 *     whole "route attention to only what matters" promise as one number — plus
 *     the supporting file/line counts.
 *  3. A severity split: a 100%-stacked bar over the findings, with a legend that
 *     names every band, count, and percentage (never colour alone).
 */

type Verdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

const VERDICT_STYLE: Record<Verdict, { color: string; label: string }> = {
  APPROVE: { color: 'var(--color-success)', label: 'Approve' },
  REQUEST_CHANGES: { color: 'var(--color-warning)', label: 'Request changes' },
  COMMENT: { color: 'var(--color-info)', label: 'Comment' },
};

function pct(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%';
}

const TILE_STYLE: CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: '8px 12px',
  minWidth: 0,
};

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): JSX.Element {
  return (
    <div style={TILE_STYLE}>
      <div
        style={{
          color: 'var(--color-text-faint)',
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '1.25rem', fontWeight: 600, color: tone ?? 'var(--color-text)' }}>
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
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Statistics are unavailable for this report.
        </p>
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
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        background: 'var(--color-surface-2)',
        display: 'grid',
        gap: 'var(--space-4)',
        marginTop: 'var(--space-3)',
      }}
    >
      {/* Row 1 — verdict + attention hero */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: '1 1 220px' }}>
          <div
            style={{
              color: 'var(--color-text-faint)',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            Verdict
          </div>
          <span
            data-testid="verdict-badge"
            style={{
              display: 'inline-block',
              marginTop: 'var(--space-2)',
              padding: '4px 12px',
              borderRadius: '999px',
              background: verdict.color,
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '0.85rem',
            }}
          >
            {verdict.label}
          </span>
        </div>

        <div style={{ flex: '1 1 320px' }}>
          <div
            style={{
              color: 'var(--color-text-faint)',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            Needs human attention
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
            <span
              data-testid="attention-pct"
              style={{ fontSize: '2rem', fontWeight: 700, color: verdict.color, lineHeight: 1.1 }}
            >
              {attentionPct}%
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>
              {stats.flaggedAddedLines} of {stats.addedLines} added lines
            </span>
          </div>
          <div
            role="img"
            aria-label={`${attentionPct}% of added lines need attention`}
            style={{
              marginTop: 'var(--space-2)',
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
                background: verdict.color,
                borderRadius: '999px',
              }}
            />
          </div>
          <div
            style={{
              marginTop: 'var(--space-1)',
              color: 'var(--color-text-faint)',
              fontSize: '0.8rem',
            }}
          >
            Issues touch {stats.flaggedFiles} of {stats.totalFiles} files
          </div>
        </div>
      </div>

      {/* Row 2 — KPI tiles for the diff size */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
          gap: 'var(--space-2)',
        }}
      >
        <Tile label="Files" value={String(stats.totalFiles)} />
        <Tile label="Added" value={`+${stats.addedLines}`} tone="var(--color-success)" />
        <Tile label="Removed" value={`−${stats.removedLines}`} tone="var(--color-danger)" />
        <Tile label="Changed" value={String(stats.changedLines)} />
      </div>

      {/* Row 3 — severity split */}
      <div>
        <div
          style={{
            color: 'var(--color-text-faint)',
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            marginBottom: 'var(--space-2)',
          }}
        >
          Findings by severity
        </div>

        <div
          data-testid="severity-bar"
          style={{
            display: 'flex',
            gap: 2,
            height: 14,
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
            background: 'var(--color-border)',
          }}
        >
          {stats.findingTotal === 0 && (
            <div style={{ flex: 1, background: 'var(--color-surface)' }} />
          )}
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
            gap: '4px 16px',
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
                fontSize: '0.85rem',
                opacity: row.count > 0 ? 1 : 0.45,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: severityColor(row.band),
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--color-text)' }}>{severityLabel(row.band)}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {row.count} ({pct(row.count, stats.findingTotal)})
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
