import type { CSSProperties } from 'react';
import type { ReviewFileDiff } from '../api/review';

/** Per-line colour for added/removed/hunk-header lines (day-23 §2.3). */
function lineStyle(line: string): CSSProperties | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return { backgroundColor: '#e6ffec' };
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return { backgroundColor: '#ffebe9' };
  }
  if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
    return { color: '#6e7781' };
  }
  return undefined;
}

/** Render Day-17 unified hunks as monospace, colour-coded lines (no syntax lib). */
export function DiffViewer({ diffs }: { readonly diffs: readonly ReviewFileDiff[] }): JSX.Element {
  if (diffs.length === 0) {
    return <p>No diff available for this change.</p>;
  }
  return (
    <div data-testid="diff-viewer">
      {diffs.map((diff) => (
        <div key={diff.path} style={{ marginBottom: 16 }}>
          <h4 style={{ fontFamily: 'monospace', margin: '4px 0' }}>
            {diff.path}{' '}
            <span>
              +{diff.addedLines}/−{diff.removedLines}
            </span>
            {diff.isNewFile && <em> (new file)</em>}
          </h4>
          <pre
            data-testid="diff-hunks"
            style={{
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              overflowX: 'auto',
              background: '#f6f8fa',
              color: '#000000',
              padding: 8,
              borderRadius: 6,
            }}
          >
            {diff.hunks.split('\n').map((line, index) => (
              <div key={index} style={lineStyle(line)}>
                {line}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}
