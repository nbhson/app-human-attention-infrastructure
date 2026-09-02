import type { FixSuggestion, ReviewFinding } from '../api/reviews';
import { AnchorBadge } from './AnchorBadge';
import { SEVERITIES, severityColor, severityLabel } from './severity';

/**
 * Review tab — the primary investigation surface. A master-detail layout:
 * findings grouped by severity on the left (a scannable list), the selected
 * finding's full case — explanation, evidence, suggested fix — on the right.
 * Selecting a finding is sticky across tabs, so switching to Diff/AI trace/
 * Verification keeps "which finding am I looking at?" answered.
 */

export function ReviewTab({
  findings,
  suggestions,
  selectedFindingId,
  onSelect,
  onOpenInDiff,
  onOpenVerification,
}: {
  readonly findings: readonly ReviewFinding[];
  readonly suggestions: readonly FixSuggestion[];
  readonly selectedFindingId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onOpenInDiff: (finding: ReviewFinding) => void;
  readonly onOpenVerification: (finding: ReviewFinding) => void;
}): JSX.Element {
  if (findings.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>No findings.</p>;
  }

  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const selected = (selectedFindingId !== null ? byId.get(selectedFindingId) : undefined) ?? null;
  const groups = SEVERITIES.map((band) => ({
    band,
    findings: findings.filter((finding) => finding.severity === band),
  })).filter((group) => group.findings.length > 0);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)',
        gap: 20,
        alignItems: 'start',
        marginTop: 16,
      }}
    >
      <div className="finding-groups">
        {groups.map((group) => (
          <section key={group.band}>
            <h3 className="finding-group-label" style={{ color: severityColor(group.band) }}>
              {severityLabel(group.band)}{' '}
              <span
                style={{
                  color: 'var(--color-text-muted)',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                ({group.findings.length})
              </span>
            </h3>
            <ul className="finding-list">
              {group.findings.map((finding) => (
                <li key={finding.id}>
                  <FindingCard
                    finding={finding}
                    hasFix={finding.suggestion !== null || suggestionsInFile(suggestions, finding.file)}
                    selected={selected?.id === finding.id}
                    onSelect={() => onSelect(finding.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {selected !== null ? (
        <FindingDetail
          finding={selected}
          suggestions={suggestions.filter((suggestion) => suggestion.file === selected.file)}
          onOpenInDiff={() => onOpenInDiff(selected)}
          onOpenVerification={() => onOpenVerification(selected)}
        />
      ) : (
        <div className="finding-detail-empty">Select a finding to see its evidence and suggested fix.</div>
      )}
    </div>
  );
}

function suggestionsInFile(suggestions: readonly FixSuggestion[], file: string): boolean {
  return suggestions.some((suggestion) => suggestion.file === file);
}

function FindingCard({
  finding,
  hasFix,
  selected,
  onSelect,
}: {
  readonly finding: ReviewFinding;
  readonly hasFix: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  const outcome = finding.kind === 'cleanup' ? 'Cleanup' : null;
  return (
    <button
      type="button"
      className={`finding-card${selected ? ' finding-card-selected' : ''}`}
      style={{ borderLeftColor: severityColor(finding.severity) }}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="finding-card-head">
        <span className="finding-card-severity" style={{ color: severityColor(finding.severity) }}>
          {severityLabel(finding.severity)}
        </span>
        <span className="finding-card-location">
          {finding.file}
          {finding.line !== null ? `:${finding.line}` : ''}
        </span>
      </div>
      <p className="finding-card-message">{finding.message}</p>
      <div className="finding-card-meta">
        <AnchorBadge anchor={finding.anchor} />
        {hasFix && (
          <span className="finding-flag finding-flag-ok">
            <span aria-hidden="true">⚙</span> fix
          </span>
        )}
        {outcome !== null && <span className="finding-flag finding-flag-muted">{outcome}</span>}
      </div>
    </button>
  );
}

function FindingDetail({
  finding,
  suggestions,
  onOpenInDiff,
  onOpenVerification,
}: {
  readonly finding: ReviewFinding;
  readonly suggestions: readonly FixSuggestion[];
  readonly onOpenInDiff: () => void;
  readonly onOpenVerification: () => void;
}): JSX.Element {
  return (
    <aside className="finding-detail">
      <div className="finding-card-head">
        <span className="finding-card-severity" style={{ color: severityColor(finding.severity), fontSize: '0.78rem' }}>
          {severityLabel(finding.severity)}
        </span>
        <span className="finding-card-location">
          {finding.file}
          {finding.line !== null ? `:${finding.line}` : ''}
        </span>
        <AnchorBadge anchor={finding.anchor} />
      </div>

      <hr className="finding-detail-rule" />

      <p className="detail-label">Explanation</p>
      <p style={{ margin: '0 0 14px', lineHeight: 1.55 }}>{finding.message}</p>

      <p className="detail-label">Evidence</p>
      <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)' }}>{finding.anchor.detail}</p>

      {finding.suggestion !== null && (
        <>
          <p className="detail-label">Suggested fix</p>
          <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)' }}>{finding.suggestion}</p>
        </>
      )}

      {suggestions.length > 0 && (
        <>
          <p className="detail-label">Fix suggestions ({suggestions.length})</p>
          {suggestions.map((suggestion) => (
            <details key={suggestion.id} className="fix-suggestion">
              <summary>
                <span>Suggested edit</span>
                <span aria-hidden="true" style={{ color: 'var(--color-text-faint)', fontSize: '0.78rem' }}>
                  +{suggestion.proposed.split('\n').length}
                </span>
              </summary>
              <div className="fix-suggestion-body">
                {suggestion.hunk !== null && (
                  <p
                    style={{
                      margin: '0 0 6px',
                      color: 'var(--color-text-faint)',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {suggestion.hunk}
                  </p>
                )}
                <pre className="detail-code">{suggestion.proposed}</pre>
                <p style={{ margin: '8px 0 0', color: 'var(--color-text-muted)' }}>{suggestion.rationale}</p>
              </div>
            </details>
          ))}
        </>
      )}

      <hr className="finding-detail-rule" />

      <div className="detail-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={onOpenInDiff}>
          Open in Diff →
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenVerification}>
          View verification
        </button>
      </div>
    </aside>
  );
}
