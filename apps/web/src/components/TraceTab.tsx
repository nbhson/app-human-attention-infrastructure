import type { ReactNode } from 'react';
import type { ReviewFinding, ReviewStats, ReviewTrace } from '../api/reviews';

/**
 * AI trace tab — the honest "what did the AI actually inspect and do?" surface.
 * A linear execution timeline built only from observable, stored metadata (start
 * time, diff size, finding count, anchor validation, model-call rows, the
 * shadow-judge scores, and the final verdict). There is deliberately no
 * transcript: `llm_call_log` is metadata-only, so this never fabricates hidden
 * chain-of-thought into prose the reviewer would mistake for a record.
 */

type Verdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

const VERDICT_LABEL: Record<Verdict, string> = {
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
  COMMENT: 'Comment',
};

function Step({
  title,
  meta,
  done,
}: {
  readonly title: string;
  readonly meta: readonly ReactNode[];
  readonly done: boolean;
}): JSX.Element {
  return (
    <li className="trace-step">
      <span className={`trace-node${done ? ' trace-node-done' : ''}`} aria-hidden="true" />
      <div className="trace-step-title">{title}</div>
      {meta.map((line, index) => (
        <p key={index} className="trace-step-meta">
          {line}
        </p>
      ))}
    </li>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function TraceTab({
  trace,
  createdAt,
  stats,
  findings,
  overallVerdict,
}: {
  readonly trace: ReviewTrace;
  readonly createdAt: string;
  readonly stats: ReviewStats | undefined;
  readonly findings: readonly ReviewFinding[];
  readonly overallVerdict: Verdict;
}): JSX.Element {
  const anchored = findings.filter((finding) => finding.anchor.status === 'verified').length;
  const findingCount = findings.length;

  return (
    <div data-testid="trace-tab" style={{ marginTop: 16 }}>
      <ol className="trace-timeline">
        <Step
          title="Review started"
          meta={[
            <span key="t" className="trace-step-time">
              {formatTime(createdAt)}
            </span>,
          ]}
          done
        />
        <Step
          title="Repository context loaded"
          meta={
            stats !== undefined
              ? [
                  `${stats.totalFiles} files changed (+${stats.addedLines} / −${stats.removedLines})`,
                ]
              : ['Differential loaded from the stored PR payload']
          }
          done
        />
        <Step
          title="Code analysis completed"
          meta={[`${findingCount} ${findingCount === 1 ? 'finding' : 'findings'} generated`]}
          done
        />
        <Step
          title="Evidence validation completed"
          meta={
            findingCount > 0
              ? [`${anchored} of ${findingCount} findings anchored in the diff`]
              : ['No findings to anchor']
          }
          done
        />
        <Step
          title="Final verdict generated"
          meta={[VERDICT_LABEL[overallVerdict] ?? overallVerdict]}
          done
        />
      </ol>

      {trace.calls.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h3 style={{ margin: '0 0 8px' }}>Model calls</h3>
          {trace.calls.map((call, index) => (
            <div
              key={index}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                padding: '8px 12px',
                marginBottom: 8,
                background: 'var(--color-surface-2)',
                fontSize: '0.85rem',
              }}
            >
              <div>
                <code>{call.model}</code> · {call.inputTokens} tokens in · {call.outputTokens}{' '}
                tokens out · {call.stopReason ?? 'stop reason unknown'}
              </div>
              <div
                style={{
                  color: 'var(--color-text-faint)',
                  fontSize: '0.78rem',
                  marginTop: 4,
                }}
              >
                request hash {call.requestHash.slice(0, 12)}… · {formatTime(call.createdAt)}
              </div>
            </div>
          ))}
        </section>
      )}

      {trace.judge.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h3 style={{ margin: '0 0 8px' }}>Independent judge</h3>
          {trace.judge.map((run, index) => (
            <div
              key={index}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                padding: '8px 12px',
                marginBottom: 8,
                background: 'var(--color-surface-2)',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>
                  <strong>overall</strong> {Math.round(run.overall * 100)}%
                </span>
                <span>
                  <strong>severity</strong> {Math.round(run.severityAgreement * 100)}%
                </span>
                <span>
                  <strong>routing</strong> {Math.round(run.routingAgreement * 100)}%
                </span>
                <span>
                  <strong>evidence</strong> {Math.round(run.evidenceSufficiency * 100)}%
                </span>
                <code>{run.model}</code>
              </div>
              {run.reasoning !== null && run.reasoning.length > 0 && (
                <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{run.reasoning}</p>
              )}
            </div>
          ))}
        </section>
      )}

      <p style={{ margin: '20px 0 0', color: 'var(--color-text-faint)', fontSize: '0.75rem' }}>
        This shows observable execution metadata only. No prompt or response transcript is stored,
        so no hidden chain-of-thought is exposed.
      </p>
    </div>
  );
}
