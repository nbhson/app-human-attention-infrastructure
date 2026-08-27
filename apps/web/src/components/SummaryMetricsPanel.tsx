import { useState } from 'react';

import type { ReviewFinding, ReviewStats } from '../api/reviews';
import { AlertTriangle, BarChart3, PieChart, ShieldCheck } from './Icons';
import { SEVERITIES, severityColor, severityLabel } from './severity';

/**
 * "Top Panel 2" of the main review screen (reference: FullReviewWorkspace's 50/50
 * SUMMARY & ARCHITECTURAL IMPACT / METRICS VISUALIZATION split). Two halves:
 *
 *  Left — the AI's own summary paragraph plus two derived one-glance insight
 *         cards, filled from the real report (never the reference's hardcoded
 *         "Build Blocker"/"Security & Runtime" narrative, which is mock content).
 *  Right — the "Metrics Visualization": a findings-by-severity donut (the
 *         actionable signal, weighted by finding count) above a GitHub-style
 *         "Languages" bar (what the change is *written in*, weighted by changed
 *         lines). Both come from the same stored report, laid out together so a
 *         reviewer sees *how serious* and *what's changed* in one glance.
 *
 * Honest-metrics rule applies: the only values shown are the ones the backend
 * actually records. Severity counts come from the findings catalogued above;
 * language shares come from the stored PR payload's file paths (an extension
 * heuristic), weighted by changed lines — never a byte-level linguist scan we
 * do not perform, and never a repo-wide percentage the report does not carry.
 * Unrecognised paths pool under "Other".
 */

/** Chart modes for the "Metrics Visualization" toggle. */
type ChartMode = 'donut' | 'bars';

/** GitHub's language colours, for the bar + legend; unrecognised → muted grey. */
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  HTML: '#e34c26',
  SCSS: '#c6538c',
  CSS: '#563d7c',
  Python: '#3572a5',
  Go: '#00add8',
  Rust: '#dea584',
  Java: '#b07219',
  Kotlin: '#a97bff',
  Scala: '#c22d40',
  Ruby: '#701516',
  PHP: '#4f5d95',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Swift: '#f05138',
  'Objective-C': '#438eff',
  Shell: '#89e051',
  SQL: '#e38c00',
  GraphQL: '#e10098',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Less: '#1d365d',
  Markdown: '#083fa1',
  MDX: '#fcb32c',
  JSON: '#292929',
  YAML: '#cb171e',
  TOML: '#9c4221',
  Dockerfile: '#384d54',
  Makefile: '#427819',
  Other: '#8e8e93',
};

function languageColor(name: string): string {
  return LANGUAGE_COLORS[name] ?? '#8e8e93';
}

/** GitHub-style one-decimal percentage of a `[0,1]` share, e.g. `46.4%`. */
function sharePct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/** A count's percentage of a total, rounded (severity legend), e.g. `33%`. */
function countPct(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%';
}

/**
 * A dependency-free SVG donut. Segments are stroked circles whose dash length is
 * each band's share of `total`; the group is rotated −90° so the first segment
 * starts at 12 o'clock and later segments continue where the previous left off.
 */
function SeverityDonut({
  rows,
}: {
  readonly rows: readonly { readonly band: string; readonly count: number }[];
}): JSX.Element {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const nonZero = rows.filter((row) => row.count > 0);
  let acc = 0;

  return (
    <svg
      viewBox="0 0 100 100"
      data-testid="severity-donut"
      role="img"
      aria-label={`Findings by severity: ${total} total`}
    >
      {/* Track */}
      <circle cx="50" cy="50" r={radius} fill="none" stroke="#1b1f27" strokeWidth="12" />
      {total > 0 && (
        <g transform="rotate(-90 50 50)">
          {nonZero.map((row) => {
            const frac = row.count / total;
            const dash = frac * circumference;
            const offset = -acc * circumference;
            acc += frac;
            return (
              <circle
                key={row.band}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={severityColor(row.band)}
                strokeWidth="12"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={offset}
              />
            );
          })}
        </g>
      )}
    </svg>
  );
}

function InsightCard({
  tone,
  icon,
  title,
  detail,
}: {
  readonly tone: 'red' | 'amber';
  readonly icon: 'alert' | 'shield';
  readonly title: string;
  readonly detail: string;
}): JSX.Element {
  const Icon = icon === 'alert' ? AlertTriangle : ShieldCheck;
  const color = tone === 'red' ? '#ef4444' : '#f97316';
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: 8,
        borderRadius: 8,
        background: '#0c1018',
        border: '1px solid rgba(39,39,42,0.6)',
      }}
    >
      <span style={{ color, display: 'inline-flex', flexShrink: 0, marginTop: 1 }}>
        <Icon size={14} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#e4e4e7' }}>{title}</span>
        <span style={{ fontSize: '0.62rem', color: '#a1a1aa', lineHeight: 1.4 }}>{detail}</span>
      </div>
    </div>
  );
}

export function SummaryMetricsPanel({
  summary,
  stats,
  findings,
}: {
  readonly summary: string;
  readonly stats: ReviewStats | undefined;
  readonly findings: readonly ReviewFinding[];
}): JSX.Element {
  const languages = stats?.languages ?? [];
  const changedLines = stats?.changedLines ?? 0;
  const totalFiles = stats?.totalFiles ?? 0;
  const findingTotal = stats?.findingTotal ?? 0;
  const severity = stats?.severity;

  // Severity donut rows: every band is listed (for a stable legend), counted from
  // the backend's own tally — never recomputed from the partially-loaded findings.
  const severityRows = SEVERITIES.map((band) => ({
    band,
    count: severity?.[band] ?? 0,
  }));

  const [mode, setMode] = useState<ChartMode>('donut');
  const maxCount = Math.max(1, ...severityRows.map((row) => row.count));

  const criticalRows = findings.filter((f) => f.severity === 'CRITICAL');
  const criticalCount = criticalRows.length;
  const topCritical = criticalRows[0];
  const flaggedFiles = stats?.flaggedFiles ?? 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 20,
        alignItems: 'stretch',
        marginTop: 20,
      }}
    >
      {/* Left — SUMMARY & ARCHITECTURAL IMPACT */}
      <section
        style={{
          padding: '20px 24px',
          borderRadius: 16,
          background: '#090d14',
          border: '1px solid rgba(39,39,42,0.9)',
          boxShadow: '0 4px 6px -2px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#a1a1aa',
                fontFamily: 'var(--font-mono)',
              }}
            >
              Summary &amp; Architectural Impact
            </span>
            <span
              style={{
                fontSize: '0.62rem',
                fontFamily: 'var(--font-mono)',
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(59,130,246,0.1)',
                border: '1px solid rgba(59,130,246,0.3)',
                color: '#60a5fa',
                whiteSpace: 'nowrap',
              }}
            >
              AI Summary
            </span>
          </div>

          <p
            style={{
              margin: 0,
              fontSize: '0.82rem',
              color: '#d4d4d8',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {summary}
          </p>
        </div>

        {/* Derived one-glance insights */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 8,
            paddingTop: 12,
            borderTop: '1px solid rgba(39,39,42,0.7)',
          }}
        >
          <InsightCard
            tone="red"
            icon="alert"
            title={
              criticalCount > 0
                ? `${criticalCount} critical finding${criticalCount === 1 ? '' : 's'}`
                : 'No critical findings'
            }
            detail={
              topCritical !== undefined
                ? `${topCritical.file}${topCritical.line !== null ? `:${topCritical.line}` : ''}`
                : 'CRITICAL severity is the merge-blocking tier.'
            }
          />
          <InsightCard
            tone="amber"
            icon="shield"
            title={`${flaggedFiles} of ${totalFiles} files`}
            detail="carry a CRITICAL, MAJOR or MINOR finding — the actionable signal."
          />
        </div>
      </section>

      {/* Right — METRICS VISUALIZATION: severity donut + languages bar */}
      <section
        style={{
          padding: '20px 24px',
          borderRadius: 16,
          background: '#090d14',
          border: '1px solid rgba(39,39,42,0.9)',
          boxShadow: '0 4px 6px -2px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            borderBottom: '1px solid rgba(39,39,42,0.8)',
            paddingBottom: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PieChart size={14} />
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#a1a1aa',
                fontFamily: 'var(--font-mono)',
              }}
            >
              Metrics Visualization
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: '#0c1018',
              padding: 2,
              borderRadius: 8,
              border: '1px solid #27272a',
            }}
          >
            <button
              type="button"
              onClick={() => setMode('donut')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 6,
                border: 'none',
                font: 'inherit',
                fontSize: '0.68rem',
                fontWeight: 500,
                cursor: 'pointer',
                background: mode === 'donut' ? '#27272a' : 'transparent',
                color: mode === 'donut' ? '#ffffff' : '#a1a1aa',
              }}
              aria-pressed={mode === 'donut'}
            >
              <PieChart size={12} />
              <span>Severity Donut</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('bars')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 6,
                border: 'none',
                font: 'inherit',
                fontSize: '0.68rem',
                fontWeight: 500,
                cursor: 'pointer',
                background: mode === 'bars' ? '#27272a' : 'transparent',
                color: mode === 'bars' ? '#ffffff' : '#a1a1aa',
              }}
              aria-pressed={mode === 'bars'}
            >
              <BarChart3 size={12} />
              <span>Issue Counts</span>
            </button>
          </div>
        </div>

        {/* Chart area — toggled between the severity donut and issue-count bars */}
        {mode === 'donut' ? (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.66rem',
                fontWeight: 600,
                color: '#e4e4e7',
                marginBottom: 10,
              }}
            >
              <PieChart size={12} />
              Findings by severity
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              {/* Donut with a centred total */}
              <div style={{ position: 'relative', width: 118, height: 118, flexShrink: 0 }}>
                <div style={{ position: 'absolute', inset: 0 }}>
                  <SeverityDonut rows={severityRows} />
                </div>
                <div
                  data-testid="donut-center"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: '1.5rem',
                      fontWeight: 700,
                      color: '#e4e4e7',
                      lineHeight: 1,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {findingTotal}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: '#71717a', marginTop: 2 }}>
                    {findingTotal === 1 ? 'finding' : 'findings'}
                  </span>
                </div>
              </div>

              {/* Severity legend */}
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {severityRows.map((row) => (
                  <li
                    key={row.band}
                    data-testid={`severity-${row.band}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: '0.7rem',
                      opacity: row.count > 0 ? 1 : 0.45,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 2,
                          background: severityColor(row.band),
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ color: '#d4d4d8', whiteSpace: 'nowrap' }}>
                        {severityLabel(row.band)}
                      </span>
                    </span>
                    <span
                      style={{
                        color: '#a1a1aa',
                        fontFamily: 'var(--font-mono)',
                        whiteSpace: 'nowrap',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      {row.count}
                      <span style={{ color: '#71717a', width: 32, textAlign: 'right' }}>
                        {countPct(row.count, findingTotal)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          /* Hand-rolled bar chart: five columns, height ∝ finding count. */
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 12,
              minHeight: 176,
              paddingTop: 12,
            }}
            role="img"
            aria-label="Findings by severity bar chart"
          >
            {severityRows.map((row) => (
              <div
                key={row.band}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    color: row.count > 0 ? '#d4d4d8' : '#52525b',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {row.count}
                </span>
                <div
                  style={{
                    width: '100%',
                    maxWidth: 28,
                    height: `${Math.max(4, (row.count / maxCount) * 96)}px`,
                    borderRadius: '4px 4px 0 0',
                    background: severityColor(row.band),
                    opacity: row.count > 0 ? 1 : 0.2,
                  }}
                />
                <span
                  style={{
                    fontSize: '0.6rem',
                    color: '#a1a1aa',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {severityLabel(row.band)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Languages divider */}
        <div
          style={{
            borderTop: '1px solid rgba(39,39,42,0.7)',
            paddingTop: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              fontSize: '0.66rem',
              fontWeight: 600,
              color: '#e4e4e7',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BarChart3 size={12} />
              Languages
            </span>
            <span
              style={{
                fontSize: '0.62rem',
                fontFamily: 'var(--font-mono)',
                color: '#71717a',
              }}
            >
              changed lines
            </span>
          </div>

          {languages.length === 0 ? (
            <p style={{ margin: 0, fontSize: '0.78rem', color: '#a1a1aa' }}>
              No changed files to break down by language.
            </p>
          ) : (
            <>
              {/* GitHub-style stacked bar, segment width ∝ changed-line share */}
              <div
                style={{
                  display: 'flex',
                  height: 12,
                  borderRadius: 6,
                  overflow: 'hidden',
                  gap: 2,
                  background: '#1b1f27',
                }}
                role="img"
                aria-label="Changed lines by language"
              >
                {languages.map((row) =>
                  row.share > 0 ? (
                    <div
                      key={row.language}
                      style={{
                        flexGrow: row.share,
                        flexBasis: 0,
                        background: languageColor(row.language),
                      }}
                    />
                  ) : null,
                )}
              </div>

              {/* Legend — GitHub's inline "dot · name 46.4%" flow, wrapping naturally */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  columnGap: 14,
                  rowGap: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                }}
              >
                {languages.map((row) => (
                  <span
                    key={row.language}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 2,
                        background: languageColor(row.language),
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: '#d4d4d8' }}>{row.language}</span>
                    <span style={{ color: '#a1a1aa' }}>{sharePct(row.share)}</span>
                  </span>
                ))}
              </div>
            </>
          )}

          {/* Telemetry footer — only real numbers, no invented density/indexed figure */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              fontSize: '0.62rem',
              color: '#71717a',
              fontFamily: 'var(--font-mono)',
              paddingTop: 10,
              borderTop: '1px solid rgba(39,39,42,0.6)',
            }}
          >
            <span>Changed lines: {changedLines.toLocaleString()}</span>
            <span style={{ color: '#10b981' }}>{totalFiles} files</span>
          </div>
        </div>
      </section>
    </div>
  );
}
