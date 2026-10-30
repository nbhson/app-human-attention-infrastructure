import type { ReviewDecision, ReviewDecisionRecord, WritebackRecord } from '../../api/reviews';
import { ChevronDown, ChevronUp } from '../Icons';

interface DecisionBarProps {
  open: boolean;
  onToggle: () => void;
  decision: ReviewDecision | null;
  onDecisionChange: (decision: ReviewDecision) => void;
  writeback: boolean;
  onWritebackChange: (writeback: boolean) => void;
  comment: string;
  onCommentChange: (comment: string) => void;
  submitError: string | null;
  submitting: boolean;
  onSubmit: () => void;
  /** The server's write-back arming (WRITEBACK_ENABLED ceiling). */
  writebackArmed: boolean;
  decisions: readonly ReviewDecisionRecord[];
  writebacks: readonly WritebackRecord[];
  onOpenWriteback: (record: WritebackRecord) => void;
}

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

/** A radio's accessible name stays the raw token so tests/AT read APPROVE; the
 *  visible chip shows a human label. */
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

/** Sticky human-decision bar — the workflow's final, and only, gate. */
export function DecisionBar({
  open,
  onToggle,
  decision,
  onDecisionChange,
  writeback,
  onWritebackChange,
  comment,
  onCommentChange,
  submitError,
  submitting,
  onSubmit,
  writebackArmed,
  decisions,
  writebacks,
  onOpenWriteback,
}: DecisionBarProps): JSX.Element {
  const requestChanges = decision === 'REQUEST_CHANGES';
  const writebackAllowed = writebackArmed && !requestChanges;

  return (
    <section className="decision-bar" style={open ? undefined : { padding: '10px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: '0.9rem' }}>
          Your decision
          {decision !== null && (
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> · {DECISION_LABEL[decision]}</span>
          )}
          {decision === null && decisions.length > 0 && (
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> · {decisions.length} submitted</span>
          )}
        </h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="decision-panel"
          aria-label={open ? 'Collapse decision panel' : 'Expand decision panel'}
          onClick={onToggle}
          className="btn btn-ghost"
          style={{ padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {open && (
        <div id="decision-panel" style={{ marginTop: 8 }}>
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
                onSubmit();
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
                      onChange={() => onDecisionChange(choice)}
                      style={visuallyHidden}
                    />
                    {DECISION_LABEL[choice]}
                  </label>
                );
              })}
              <button
                type="submit"
                disabled={decision === null || submitting}
                className={decision === null ? 'btn btn-ghost' : 'btn btn-primary'}
                style={{ marginLeft: 'auto' }}
              >
                {submitting ? 'Submitting…' : 'Submit decision'}
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
                  onChange={(event) => onWritebackChange(event.target.checked)}
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
                  onChange={(event) => onCommentChange(event.target.value)}
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

          {decisions.length > 0 && (
            <div
              data-testid="decision-audit"
              style={{ marginTop: 12, fontSize: '0.82rem', color: 'var(--color-text-muted)' }}
            >
              {decisions.map((record) => (
                <div key={record.id} style={{ marginBottom: 2 }}>
                  <strong>{record.decision}</strong>
                  {record.rationale !== null && ` — ${record.rationale}`}
                  {' · '}
                  {new Date(record.createdAt).toLocaleString()}
                  {' · '}
                  {record.writebackEnabled ? 'write-back ON' : 'write-back OFF'}
                </div>
              ))}
              {writebacks.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => onOpenWriteback(record)}
                  style={{
                    marginLeft: 16,
                    padding: '4px 8px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-info)',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontSize: '0.82rem',
                    textAlign: 'left',
                    font: 'inherit',
                  }}
                >
                  {record.provider}/{record.action}: {record.status}
                  {record.error !== null && ` — ${record.error}`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
