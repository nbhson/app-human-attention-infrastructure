import type { ReactNode } from 'react';
import type { JudgeRun } from '../api/reviews';

function DimensionCard({
  title,
  score,
  description,
  children,
}: {
  readonly title: string;
  readonly score: number;
  readonly description: string;
  readonly children?: ReactNode;
}): JSX.Element {
  const pct = Math.round(score * 100);
  const getColor = (s: number): string => {
    if (s >= 0.8) return 'var(--color-success)';
    if (s >= 0.6) return 'var(--color-warning)';
    return 'var(--color-danger)';
  };
  const color = getColor(score);

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: '12px 16px',
        background: 'var(--color-surface)',
        flex: 1,
        minWidth: 200,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }}>{title}</h4>
        <span
          style={{
            fontSize: '1.25rem',
            fontWeight: 700,
            color,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {pct}%
        </span>
      </div>
      <p style={{ margin: '0 0 8px', fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
        {description}
      </p>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--color-bg)', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 2,
            background: color,
          }}
        />
      </div>
      {children}
    </div>
  );
}

export function ShadowJudgePanel({ judgeRuns }: { readonly judgeRuns: readonly JudgeRun[] }): JSX.Element {
  if (judgeRuns.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--color-text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
        No shadow judge runs recorded for this review.
      </div>
    );
  }

  const latestRun = judgeRuns[judgeRuns.length - 1];

  return (
    <section style={{ marginTop: 20 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 600 }}>Shadow Judge Analysis</h3>
      <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
        Independent evaluation of the review report quality. Scores are 0–100%; higher = better alignment with expected
        severity, routing, and evidence standards.
      </p>

      {/* Overall Score Card */}
      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: '16px',
          background: 'var(--color-surface)',
          marginBottom: 16,
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
        >
          <div>
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 4,
              }}
            >
              Overall Quality Score
            </div>
            <div
              style={{
                fontSize: '2.5rem',
                fontWeight: 700,
                color: 'var(--color-info)',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}
            >
              {Math.round(latestRun.overall * 100)}%
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 140 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Model: <code>{latestRun.model}</code>
            </div>
            {latestRun.promptVersion && (
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                Prompt: <code>{latestRun.promptVersion}</code>
              </div>
            )}
            {latestRun.temperature !== null && latestRun.temperature !== undefined && (
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                Temperature: {latestRun.temperature}
              </div>
            )}
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {new Date(latestRun.createdAt).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Dimension Breakdown */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <DimensionCard
          title="Severity Agreement"
          score={latestRun.severityAgreement}
          description="Did the report rate each finding's severity correctly?"
        />
        <DimensionCard
          title="Routing Agreement"
          score={latestRun.routingAgreement}
          description="Did the report route the PR to the right human attention level?"
        />
        <DimensionCard
          title="Evidence Sufficiency"
          score={latestRun.evidenceSufficiency}
          description="Is every claim backed by evidence (message + suggestion/file/line)?"
        />
      </div>

      {/* Reasoning */}
      {latestRun.reasoning !== null && latestRun.reasoning.length > 0 && (
        <div
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            padding: '12px 16px',
            background: 'var(--color-surface-2)',
            marginBottom: 16,
          }}
        >
          <h4 style={{ margin: '0 0 8px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Judge Reasoning
          </h4>
          <pre
            style={{
              margin: 0,
              fontSize: '0.8rem',
              fontFamily: 'inherit',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--color-text)',
            }}
          >
            {latestRun.reasoning}
          </pre>
        </div>
      )}

      {/* Historical Runs */}
      {judgeRuns.length > 1 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            Show {judgeRuns.length - 1} previous judge run{judgeRuns.length > 2 ? 's' : ''}
          </summary>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {judgeRuns.slice(0, -1).map((run, index) => (
              <div
                key={index}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: '10px 12px',
                  background: 'var(--color-surface-2)',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span>
                    <strong>Overall:</strong> {Math.round(run.overall * 100)}%
                  </span>
                  <span>
                    <strong>Severity:</strong> {Math.round(run.severityAgreement * 100)}%
                  </span>
                  <span>
                    <strong>Routing:</strong> {Math.round(run.routingAgreement * 100)}%
                  </span>
                  <span>
                    <strong>Evidence:</strong> {Math.round(run.evidenceSufficiency * 100)}%
                  </span>
                  <code>{run.model}</code>
                </div>
                <div style={{ color: 'var(--color-text-faint)', fontSize: '0.75rem' }}>
                  {new Date(run.createdAt).toLocaleString()}
                  {run.promptVersion && ` · Prompt: ${run.promptVersion}`}
                </div>
                {run.reasoning && (
                  <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: '0.78rem' }}>{run.reasoning}</p>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
