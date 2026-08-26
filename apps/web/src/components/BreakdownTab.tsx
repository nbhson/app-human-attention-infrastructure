import type { CSSProperties } from 'react';

import type { ReviewSeverity, ReviewStats } from '../api/reviews';
import { severityColor, severityLabel } from './severity';

/**
 * Breakdown tab (review-reorient Phase 3) — the "why does that number say
 * that?" answer. The attention hero is a single percentage; this tab lays out
 * the arithmetic and its inputs so a reviewer can prove the number in three
 * glances:
 *
 *  1. Which files are flagged → exactly why it reads "4 of 19".
 *  2. Which findings count toward attention vs. don't (NIT/INFO are noise).
 *  3. What the added source lines actually are (a greenfield PR is mostly test
 *     specs/styles, not dense logic — findings-per-line is not linear).
 */

const ACTIONABLE: readonly ReviewSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR'];
const NOISE: readonly ReviewSeverity[] = ['NIT', 'INFO'];

const CATEGORY_LABEL: Record<string, string> = {
  test: 'Test specs',
  style: 'Stylesheets',
  markup: 'Markup',
  source: 'Source code',
  config: 'Config / docs / infra',
};

function pct(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%';
}

const TILE: CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: '8px 12px',
  background: 'var(--color-surface)',
};

const SMALL: CSSProperties = {
  color: 'var(--color-text-faint)',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

export function BreakdownTab({ stats }: { readonly stats: ReviewStats | undefined }): JSX.Element {
  if (stats === undefined) {
    return (
      <p data-testid="breakdown-tab-empty" style={{ color: 'var(--color-text-muted)' }}>
        Statistics are unavailable for this report.
      </p>
    );
  }

  const attentionPct = Math.round(stats.attentionShare * 100);
  const signalCount = ACTIONABLE.reduce((sum, band) => sum + (stats.severity[band] ?? 0), 0);
  const noiseCount = NOISE.reduce((sum, band) => sum + (stats.severity[band] ?? 0), 0);

  return (
    <div
      data-testid="breakdown-tab"
      style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 16 }}
    >
      {/* 1 — the share, explained and proved */}
      <section>
        <h3 style={{ marginTop: 0 }}>Why {attentionPct}%?</h3>
        <p style={{ color: 'var(--color-text-muted)' }}>
          {attentionPct}% means{' '}
          <strong data-testid="attention-files">
            {stats.flaggedFiles} of {stats.totalFiles} files
          </strong>{' '}
          carry a CRITICAL, MAJOR or MINOR finding. It counts files, not lines, and it counts every
          file a human wrote — source, docs, config and infra; only generated artifacts (lockfiles,
          build output) are excluded. NIT and INFO don't count.
        </p>

        {stats.flaggedFilesList.length > 0 ? (
          <>
            <p style={{ ...SMALL, margin: 'var(--space-3) 0 var(--space-1)' }}>Flagged files</p>
            <ul data-testid="flagged-files" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {stats.flaggedFilesList.map(({ file, severities }) => (
                <li
                  key={file}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    padding: '6px 0',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <code style={{ wordBreak: 'break-word' }}>{file}</code>
                  <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                    {severities.map((severity) => (
                      <span
                        key={severity}
                        style={{
                          color: severityColor(severity),
                          fontWeight: 700,
                          fontSize: '0.72rem',
                          textTransform: 'uppercase',
                        }}
                      >
                        {severityLabel(severity)}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>
            No file carries an actionable finding — clean diff.
          </p>
        )}
      </section>

      {/* 2 — signal vs noise */}
      <section>
        <h3 style={{ marginTop: 0 }}>Findings that count vs. don't</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 'var(--space-2)',
          }}
        >
          <div style={TILE}>
            <div style={SMALL}>Count toward attention</div>
            <div data-testid="signal-count" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
              {signalCount}
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
              CRITICAL · MAJOR · MINOR
            </div>
          </div>
          <div style={TILE}>
            <div style={SMALL}>Shown but not counted</div>
            <div data-testid="noise-count" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
              {noiseCount}
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>NIT · INFO</div>
          </div>
        </div>
        <p style={{ color: 'var(--color-text-muted)', margin: 'var(--space-2) 0 0' }}>
          NIT findings are nitpicks (a missing trailing newline, a naming preference) and INFO is
          praise — neither is a call for attention, so they stay in the findings list but never move
          the percentage.
        </p>
      </section>

      {/* 3 — what the added lines actually are */}
      <section>
        <h3 style={{ marginTop: 0 }}>Where the {stats.addedLines} added lines are</h3>
        {stats.composition.length > 0 ? (
          <ul data-testid="composition" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {stats.composition.map((row) => (
              <li
                key={row.category}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'baseline',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <span style={{ flex: '0 0 140px', color: 'var(--color-text)' }}>
                  {CATEGORY_LABEL[row.category] ?? row.category}
                </span>
                <span
                  style={{
                    flex: '0 0 64px',
                    color: 'var(--color-text-muted)',
                    fontSize: '0.85rem',
                  }}
                >
                  {row.files} files
                </span>
                <span style={{ flex: '0 0 80px', color: 'var(--color-success)', fontWeight: 600 }}>
                  +{row.additions}
                </span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  {pct(row.additions, stats.addedLines)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>No hand-written files in this diff.</p>
        )}
        <p style={{ color: 'var(--color-text-muted)', margin: 'var(--space-2) 0 0' }}>
          {stats.excluded.files > 0
            ? `${stats.excluded.files} more files (+${stats.excluded.additions} lines) — generated artifacts like lockfiles and build output — sit outside the attention metric. `
            : ''}
          Findings-per-line isn't linear: a greenfield PR of mostly test specs and styles has far
          fewer findings than a dense logic change, so a low finding count on a big line count isn't
          under-review.
        </p>

        {stats.excluded.filesList.length > 0 ? (
          <>
            <p style={{ ...SMALL, margin: 'var(--space-3) 0 var(--space-1)' }}>
              Files outside the metric
            </p>
            <ul data-testid="excluded-files" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {stats.excluded.filesList.map(({ path, additions }) => (
                <li
                  key={path}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    padding: '5px 0',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <code style={{ wordBreak: 'break-word' }}>{path}</code>
                  <span
                    style={{
                      color: 'var(--color-text-muted)',
                      fontSize: '0.8rem',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    +{additions}
                  </span>
                  <span
                    style={{
                      color: 'var(--color-text-faint)',
                      fontSize: '0.72rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Generated
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {/* 4 — cleanup opportunities: the remove/simplify axis, separate from bugs */}
      <section>
        <h3 style={{ marginTop: 0 }}>Cleanup opportunities</h3>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Dead code, unused functions, duplication, magic numbers and confusing naming — findings
          whose action is <em>remove / simplify</em>, not <em>fix</em>. They don't move the
          attention percentage, but they're listed here so a redundant function isn't lost in the
          noise.
        </p>

        {stats.cleanup.files > 0 ? (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 'var(--space-2)',
                marginBottom: 'var(--space-2)',
              }}
            >
              <div style={TILE}>
                <div style={SMALL}>Files</div>
                <div data-testid="cleanup-files" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                  {stats.cleanup.files}
                </div>
              </div>
              <div style={TILE}>
                <div style={SMALL}>Findings</div>
                <div
                  data-testid="cleanup-findings"
                  style={{ fontSize: '1.25rem', fontWeight: 600 }}
                >
                  {stats.cleanup.findings}
                </div>
              </div>
            </div>
            <ul
              data-testid="cleanup-files-list"
              style={{ listStyle: 'none', padding: 0, margin: 0 }}
            >
              {stats.cleanup.filesList.map(({ file, count }) => (
                <li
                  key={file}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    padding: '6px 0',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <code style={{ wordBreak: 'break-word' }}>{file}</code>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                    {count} {count === 1 ? 'finding' : 'findings'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>No dead code / duplication flagged.</p>
        )}
      </section>
    </div>
  );
}
