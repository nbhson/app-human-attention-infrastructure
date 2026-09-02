import { useEffect, useRef } from 'react';
import type { PrFile, ReviewFinding } from '../api/reviews';
import type { ReviewFileDiff } from '../api/review';
import { severityColor, severityLabel } from './severity';
import { DiffViewer } from './DiffViewer';

/** Map a normalised PR file to the shape the diff renderer expects. */
function toViewerDiff(file: PrFile): ReviewFileDiff {
  return {
    path: file.path,
    hunks: file.patch,
    addedLines: file.additions,
    removedLines: file.deletions,
    isNewFile: file.status === 'added',
  };
}

/**
 * Diff tab (evidence layer) — the changed code per file, with a line-number
 * gutter so a finding's `file:line` maps to a concrete row. A findings strip up
 * top and per-file finding chips let the reviewer jump to any finding; the
 * selected finding's line is highlighted and the view auto-scrolls to its file.
 */
export function DiffTab({
  diff,
  findings,
  selectedFindingId,
  onSelectFinding,
}: {
  readonly diff: readonly PrFile[];
  readonly findings: readonly ReviewFinding[];
  readonly selectedFindingId: string | null;
  readonly onSelectFinding: (id: string) => void;
}): JSX.Element {
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const selected = findings.find((finding) => finding.id === selectedFindingId) ?? null;

  // When the selected finding changes (e.g. "Open in Diff" from the Review tab),
  // bring its file into view.
  useEffect(() => {
    if (selected !== null) {
      const el = sectionRefs.current.get(selected.file);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedFindingId]);

  if (diff.length === 0) {
    return (
      <p data-testid="diff-tab-empty" style={{ color: 'var(--color-text-muted)' }}>
        No diff available for this review (the stored PR payload carried no file list).
      </p>
    );
  }

  return (
    <div data-testid="diff-tab" style={{ marginTop: 16 }}>
      {findings.length > 0 && (
        <div className="diff-jump-strip">
          <span className="detail-label">Jump to finding</span>
          {findings.map((finding) => {
            const active = selected?.id === finding.id;
            return (
              <button
                key={finding.id}
                type="button"
                className={`pill${active ? ' pill-active' : ''}`}
                onClick={() => onSelectFinding(finding.id)}
              >
                {severityLabel(finding.severity)}{' '}
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {finding.file}
                  {finding.line !== null ? `:${finding.line}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {diff.map((file) => {
        const fileFindings = findings.filter((finding) => finding.file === file.path);
        const highlightLines =
          selected !== null && selected.file === file.path && selected.line !== null ? [selected.line] : [];
        return (
          <section
            key={file.path}
            className="diff-file"
            ref={(el) => {
              if (el !== null) {
                sectionRefs.current.set(file.path, el);
              } else {
                sectionRefs.current.delete(file.path);
              }
            }}
          >
            <div className="diff-file-head">
              <strong>{file.path}</strong>
              <span style={{ color: 'var(--color-text-muted)' }}>
                <span style={{ color: 'var(--color-success)' }}>+{file.additions}</span>{' '}
                <span style={{ color: 'var(--color-danger)' }}>−{file.deletions}</span>
              </span>
              {file.status === 'added' && <em>(new file)</em>}
            </div>

            {fileFindings.length > 0 && (
              <div style={{ padding: '8px 12px 0' }}>
                {fileFindings.map((finding) => {
                  const active = selected?.id === finding.id;
                  return (
                    <button
                      key={finding.id}
                      type="button"
                      className={active ? 'finding-card finding-card-selected' : 'finding-card'}
                      style={{ borderLeftColor: severityColor(finding.severity) }}
                      onClick={() => onSelectFinding(finding.id)}
                    >
                      <div className="finding-card-head">
                        <span className="finding-card-severity" style={{ color: severityColor(finding.severity) }}>
                          {severityLabel(finding.severity)}
                        </span>
                        <span className="finding-card-location">
                          {finding.line !== null ? `line ${finding.line}` : finding.file}
                        </span>
                      </div>
                      <p className="finding-card-message">{finding.message}</p>
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ padding: '4px 8px 8px' }}>
              <DiffViewer diffs={[toViewerDiff(file)]} showLineNumbers highlightLines={highlightLines} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
