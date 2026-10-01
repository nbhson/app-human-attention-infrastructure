import type { ReactNode } from 'react';
import type { RecalledMemory, ReviewFinding, ReviewStats, ReviewTrace } from '../api/reviews';
import { RecalledMemoriesPanel } from './RecalledMemoriesPanel';
import { ShadowJudgePanel } from './ShadowJudgePanel';

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

/** `125000` → `"2m 5s"`; sub-minute stays seconds-only. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown duration';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function TraceTab({
  trace,
  createdAt,
  completedAt,
  stats,
  findings,
  overallVerdict,
  recalledMemories,
}: {
  readonly trace: ReviewTrace;
  readonly createdAt: string;
  /** Null while the review is still in flight or on legacy rows. */
  readonly completedAt: string | null;
  readonly stats: ReviewStats | undefined;
  readonly findings: readonly ReviewFinding[];
  readonly overallVerdict: Verdict;
  readonly recalledMemories?: readonly RecalledMemory[] | null;
}): JSX.Element {
  const anchored = findings.filter((finding) => finding.anchor.status === 'verified').length;
  const findingCount = findings.length;
  const totalIn = trace.calls.reduce((sum, call) => sum + call.inputTokens, 0);
  const totalOut = trace.calls.reduce((sum, call) => sum + call.outputTokens, 0);
  const startedMs = new Date(createdAt).getTime();
  const completedMs = completedAt !== null ? new Date(completedAt).getTime() : NaN;
  const durationLabel =
    completedAt !== null && Number.isFinite(startedMs) && Number.isFinite(completedMs) && completedMs >= startedMs
      ? formatDuration(completedMs - startedMs)
      : null;

  const repaired = (trace as unknown as { wasRepaired?: boolean }).wasRepaired === true;
  const traceAction: { title: string; body: string } = repaired
    ? {
        title: 'Action needed: AI output was truncated and auto-repaired',
        body: 'Treat findings below as suspect — cross-check each against the Diff tab before deciding.',
      }
    : findingCount === 0
      ? {
          title: 'No findings — nothing to trace further',
          body: 'The AI surfaced nothing actionable. Skim the Diff tab or move straight to the decision bar.',
        }
      : anchored < findingCount
        ? {
            title: `Action needed: ${findingCount - anchored} of ${findingCount} findings are unanchored`,
            body: 'Open them in the Review tab and confirm each cited file:line exists in the diff.',
          }
        : {
            title: 'Trace is clean — evidence lines up',
            body: 'Every finding anchors in the diff. Use the timeline below for provenance, then decide.',
          };

  return (
    <div data-testid="trace-tab" style={{ marginTop: 16 }}>
      <div
        data-testid="trace-action"
        role="alert"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 16,
          background: 'var(--color-surface)',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{traceAction.title}</div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{traceAction.body}</div>
      </div>
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
              ? [`${stats.totalFiles} files changed (+${stats.addedLines} / −${stats.removedLines})`]
              : ['Differential loaded from the stored PR payload']
          }
          done
        />
        <Step
          title="Past context recalled"
          meta={
            recalledMemories === null || recalledMemories === undefined
              ? ['No recall metadata stored for this report']
              : recalledMemories.length === 0
                ? ['Recall ran — nothing relevant found']
                : [
                    `${recalledMemories.length} ${recalledMemories.length === 1 ? 'memory' : 'memories'} recalled — see panel below`,
                  ]
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
        <Step title="Final verdict generated" meta={[VERDICT_LABEL[overallVerdict] ?? overallVerdict]} done />
        <Step
          title="Review completed"
          meta={
            completedAt !== null
              ? [
                  <span key="t" className="trace-step-time">
                    {formatTime(completedAt)}
                  </span>,
                  ...(durationLabel !== null ? [`Total pipeline time: ${durationLabel}`] : []),
                ]
              : ['Still in flight — no completion timestamp stored yet']
          }
          done={completedAt !== null}
        />
      </ol>

      {recalledMemories !== null && recalledMemories !== undefined && (
        <RecalledMemoriesPanel memories={recalledMemories} />
      )}

      {trace.calls.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h3 style={{ margin: '0 0 4px' }}>Model calls</h3>
          <p
            data-testid="trace-tokens"
            style={{ margin: '0 0 8px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}
          >
            {trace.calls.length} {trace.calls.length === 1 ? 'call' : 'calls'} · {totalIn.toLocaleString()} tokens in
            {' → '}
            {totalOut.toLocaleString()} out
          </p>
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
                <code>{call.model}</code> · {call.inputTokens} tokens in · {call.outputTokens} tokens out ·{' '}
                {call.stopReason ?? 'stop reason unknown'}
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
        <>
          <section style={{ marginTop: 20 }}>
            <h3 style={{ margin: '0 0 8px' }}>Independent judge (legacy view)</h3>
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

          <ShadowJudgePanel judgeRuns={trace.judge} />
        </>
      )}

      <p style={{ margin: '20px 0 0', color: 'var(--color-text-faint)', fontSize: '0.75rem' }}>
        This shows observable execution metadata only. No prompt or response transcript is stored, so no hidden
        chain-of-thought is exposed.
      </p>
    </div>
  );
}
