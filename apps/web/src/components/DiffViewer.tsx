import type { ReviewFileDiff } from '../api/review';

/** Per-line colour for added/removed/hunk-header lines, as a theme-aware class. */
function lineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'diff-line-add';
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'diff-line-rem';
  }
  if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
    return 'diff-line-hunk';
  }
  return '';
}

/**
 * Compute the new-file line number for each line of a unified diff, so a
 * finding's `file:line` can be mapped to a concrete gutter row. Returns `null`
 * for removed lines, file headers and "\ No newline" markers (which occupy no
 * new-file line).
 */
function computeNewLines(hunks: string): readonly (number | null)[] {
  const lines = hunks.split('\n');
  const nums: (number | null)[] = new Array(lines.length).fill(null);
  let newLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.startsWith('@@')) {
      const start = /\+(\d+)/.exec(line)?.[1];
      newLine = start !== undefined ? parseInt(start, 10) : 0;
    } else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) {
      // File headers and "\ No newline at end of file" markers carry no number.
    } else if (line.startsWith('+')) {
      nums[i] = newLine;
      newLine += 1;
    } else if (line.startsWith('-')) {
      // Removed lines live on the old-file side; no new-file number.
    } else {
      nums[i] = newLine;
      newLine += 1;
    }
  }
  return nums;
}

/** Render unified hunks as monospace, colour-coded lines (no syntax lib). */
export function DiffViewer({
  diffs,
  showLineNumbers = false,
  highlightLines,
}: {
  readonly diffs: readonly ReviewFileDiff[];
  /** Render a line-number gutter so a finding's `file:line` can be located. */
  readonly showLineNumbers?: boolean;
  /** New-file line numbers to highlight (the selected finding's anchor). */
  readonly highlightLines?: readonly number[];
}): JSX.Element {
  if (diffs.length === 0) {
    return <p>No diff available for this change.</p>;
  }
  const highlights = new Set(highlightLines ?? []);

  return (
    <div data-testid="diff-viewer">
      {diffs.map((diff) => {
        const numLines = showLineNumbers ? computeNewLines(diff.hunks) : null;
        const rows = diff.hunks.split('\n');
        return (
          <div key={diff.path} style={{ marginBottom: 16 }}>
            <h4 style={{ fontFamily: 'var(--font-mono)', margin: '4px 0', fontSize: '0.82rem' }}>
              {diff.path}{' '}
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                +{diff.addedLines}/−{diff.removedLines}
              </span>
              {diff.isNewFile && <em> (new file)</em>}
            </h4>
            <pre
              data-testid="diff-hunks"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
                overflowX: 'auto',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                padding: '8px 0',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--color-border)',
                margin: 0,
              }}
            >
              {rows.map((line, index) => {
                const num = numLines !== null ? (numLines[index] ?? null) : null;
                const highlighted = num !== null && highlights.has(num);
                return (
                  <div
                    key={index}
                    className={`diff-line ${lineClass(line)}${highlighted ? ' diff-line-highlight' : ''}`}
                  >
                    {numLines !== null && (
                      <span className="diff-line-num">{num !== null ? num : ''}</span>
                    )}
                    {line}
                  </div>
                );
              })}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
