import type { PrFile, ReviewFinding } from '../api/reviews';
import type { ReviewFileDiff } from '../api/review';
import { AnchorBadge } from './AnchorBadge';
import { severityColor, severityLabel } from './severity';
import { DiffViewer } from './DiffViewer';

/** Map a normalised PR file to the shape the existing diff renderer expects. */
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
 * Diff tab (trust-loop slice 2) — the actual changed code, per file, colour-coded,
 * with the findings that point at that file listed above their diff so a reviewer
 * sees the claim next to the code instead of trusting a floating line number.
 */
export function DiffTab({
  diff,
  findings,
}: {
  readonly diff: readonly PrFile[];
  readonly findings: readonly ReviewFinding[];
}): JSX.Element {
  if (diff.length === 0) {
    return (
      <p data-testid="diff-tab-empty" style={{ color: 'var(--color-text-muted)' }}>
        No diff available for this review (the stored PR payload carried no file list).
      </p>
    );
  }

  return (
    <div data-testid="diff-tab">
      {diff.map((file) => {
        const fileFindings = findings.filter((finding) => finding.file === file.path);
        return (
          <section key={file.path} style={{ marginBottom: 24 }}>
            {fileFindings.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px' }}>
                {fileFindings.map((finding) => (
                  <li
                    key={finding.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'baseline',
                      flexWrap: 'wrap',
                      marginBottom: 4,
                      fontSize: '0.85rem',
                    }}
                  >
                    <span
                      style={{
                        color: severityColor(finding.severity),
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      {severityLabel(finding.severity)}
                    </span>
                    <AnchorBadge anchor={finding.anchor} />
                    <span>
                      {finding.message}
                      {finding.line !== null ? ` (line ${finding.line})` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <DiffViewer diffs={[toViewerDiff(file)]} />
          </section>
        );
      })}
    </div>
  );
}
