import type { ReviewTrace } from '../api/reviews';

/** Judge scores are stored 0..1; present them as a whole-percent readout. */
function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const callCard = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: '8px 12px',
  marginBottom: 8,
  background: 'var(--color-surface-2)',
} as const;

/**
 * AI trace tab — the honest "how was this produced" surface. NOTE: `llm_call_log`
 * is metadata-only (no stored prompt/response), so this shows model + token
 * counts + stop reason + request hash, and separately the shadow-judge scores,
 * never a fabricated transcript.
 */
export function TraceTab({ trace }: { readonly trace: ReviewTrace }): JSX.Element {
  return (
    <div data-testid="trace-tab">
      <section style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Model call</h3>
        {trace.calls.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)' }}>
            No model-call metadata recorded for this review.
          </p>
        )}
        {trace.calls.map((call, index) => (
          <div key={index} style={callCard}>
            <div>
              <code>{call.model}</code> · {call.inputTokens} tokens in · {call.outputTokens} tokens
              out · {call.stopReason ?? 'stop reason unknown'}
            </div>
            <div
              style={{
                color: 'var(--color-text-faint)',
                fontSize: '0.8rem',
                marginTop: 4,
              }}
            >
              request hash {call.requestHash.slice(0, 12)}… ·{' '}
              {new Date(call.createdAt).toLocaleString()}
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3>Independent judge</h3>
        {trace.judge.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)' }}>
            No shadow-judge run recorded for this report.
          </p>
        )}
        {trace.judge.map((run, index) => (
          <div key={index} style={callCard}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span>
                <strong>overall</strong> {pct(run.overall)}
              </span>
              <span>
                <strong>severity</strong> {pct(run.severityAgreement)}
              </span>
              <span>
                <strong>routing</strong> {pct(run.routingAgreement)}
              </span>
              <span>
                <strong>evidence</strong> {pct(run.evidenceSufficiency)}
              </span>
              <code>{run.model}</code>
            </div>
            {run.reasoning !== null && run.reasoning.length > 0 && (
              <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{run.reasoning}</p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
