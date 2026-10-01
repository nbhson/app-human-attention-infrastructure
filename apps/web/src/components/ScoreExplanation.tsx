import { useEffect, useId, useRef, useState } from 'react';

import type { ReviewFinding, ReviewStats } from '../api/reviews';

export type ScoreDimensionKey = 'architecture' | 'codeQuality' | 'security' | 'performance' | 'testing';

export interface ScoreSuggestion {
  readonly findingId: string;
  readonly file: string;
  readonly line: number | null;
  readonly message: string;
  readonly suggestion: string | null;
}

export interface DimensionExplanation {
  readonly reasons: readonly string[];
  readonly suggestions: readonly ScoreSuggestion[];
}

const KEYWORDS: Record<ScoreDimensionKey, readonly string[]> = {
  architecture: [
    'architect',
    'coupling',
    'cohesion',
    'layer',
    'module',
    'circular',
    'dependency',
    'pattern',
    'solid',
    'separation',
    'responsibility',
    'core',
  ],
  codeQuality: ['complex', 'duplicat', 'maintain', 'readab', 'clarity', 'naming', 'dead code', 'cleanup'],
  security: [
    'auth',
    'secret',
    'password',
    'token',
    'injection',
    'xss',
    'sql',
    'crypto',
    'tls',
    'cert',
    'csrf',
    'permission',
    'vulnerab',
    'exploit',
    'sanitiz',
    'security',
  ],
  performance: [
    'memory leak',
    'leak',
    'latency',
    'n+1',
    'n + 1',
    'index',
    'cache',
    'slow',
    'regression',
    'perf',
    'timeout',
    'blocking',
    'query',
  ],
  testing: ['test', 'coverage', 'spec', 'assert', 'mock', 'snapshot'],
};

const GENERIC_SUGGESTIONS: Record<ScoreDimensionKey, readonly string[]> = {
  architecture: [
    'Split oversized modules and keep dependency direction one-way.',
    'Move shared logic behind a clear boundary instead of cross-imports.',
  ],
  codeQuality: [
    'Remove duplication and simplify the most complex function first.',
    'Prefer small, named helpers over long inline blocks.',
  ],
  security: [
    'Re-check auth paths and make sure no secret or token is logged or hardcoded.',
    'Validate and sanitize external input at the boundary.',
  ],
  performance: [
    'Avoid N+1 queries and missing indexes on the touched paths.',
    'Cache repeated reads and guard hot loops against unbounded growth.',
  ],
  testing: [
    'Add or update tests covering the changed behaviour.',
    'Aim for at least 1 test file per touched source file.',
  ],
};

function haystack(f: ReviewFinding): string {
  return `${f.file} ${f.message} ${f.suggestion ?? ''}`.toLowerCase();
}

function matchesKeywords(f: ReviewFinding, key: ScoreDimensionKey): boolean {
  const text = haystack(f);
  return KEYWORDS[key].some((kw) => text.includes(kw));
}

function severityRank(sev: ReviewFinding['severity']): number {
  switch (sev) {
    case 'CRITICAL':
      return 0;
    case 'MAJOR':
      return 1;
    case 'MINOR':
      return 2;
    case 'NIT':
      return 3;
    case 'INFO':
      return 4;
  }
}

/** Heuristic correlation: which findings likely dragged this dimension below 100. */
export function findingsForDimension(
  dimension: ScoreDimensionKey,
  findings: readonly ReviewFinding[],
): readonly ReviewFinding[] {
  const actionable = findings.filter((f) => f.severity !== 'NIT' && f.severity !== 'INFO');
  let related: readonly ReviewFinding[];
  if (dimension === 'codeQuality') {
    // Code quality is the density signal — every actionable finding counts.
    related = actionable;
  } else if (dimension === 'architecture') {
    const keyworded = actionable.filter((f) => matchesKeywords(f, 'architecture'));
    const majors = actionable.filter((f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR');
    const merged = new Map<string, ReviewFinding>();
    for (const f of [...keyworded, ...majors]) merged.set(f.id, f);
    related = [...merged.values()];
  } else {
    related = actionable.filter((f) => matchesKeywords(f, dimension));
    // A CRITICAL in a security-like path is always security-relevant, even without keywords.
    if (dimension === 'security') {
      const criticalPath = actionable.filter(
        (f) =>
          f.severity === 'CRITICAL' &&
          /auth|secret|token|login|session|crypto|password/i.test(`${f.file} ${f.message}`),
      );
      const merged = new Map<string, ReviewFinding>();
      for (const f of [...related, ...criticalPath]) merged.set(f.id, f);
      related = [...merged.values()];
    }
  }
  return [...related].sort((a, b) => severityRank(a.severity) - severityRank(b.severity)).slice(0, 5);
}

function testingRatioLine(stats: ReviewStats | undefined): string | null {
  if (!stats) return null;
  const test = stats.composition.find((c) => c.category === 'test');
  const source = stats.composition.find((c) => c.category === 'source');
  const testFiles = test?.files ?? 0;
  const sourceFiles = source?.files ?? 0;
  if (testFiles === 0 && sourceFiles === 0) return null;
  const ratio = sourceFiles === 0 ? 100 : Math.round((testFiles / Math.max(1, sourceFiles)) * 100);
  return `Test-to-source ratio ${ratio}% (${testFiles} test file(s) / ${sourceFiles} source file(s))`;
}

export function buildDimensionExplanation(
  dimension: ScoreDimensionKey,
  score: number,
  findings: readonly ReviewFinding[],
  stats?: ReviewStats,
): DimensionExplanation {
  const related = findingsForDimension(dimension, findings);
  const reasons: string[] = [];
  const suggestions: ScoreSuggestion[] = related.slice(0, 3).map((f) => ({
    findingId: f.id,
    file: f.file,
    line: f.line,
    message: f.message,
    suggestion: f.suggestion,
  }));

  if (dimension === 'testing') {
    const line = testingRatioLine(stats);
    if (line) reasons.push(line);
    if (related.length > 0) {
      const counts = countBySeverity(related);
      reasons.push(`${related.length} testing-related finding(s)${counts ? ` — ${counts}` : ''}`);
    }
    if (reasons.length === 0 && score < 100) {
      reasons.push(`No test coverage signal for this change (score ${score}/100).`);
    }
  } else if (dimension === 'codeQuality') {
    if (related.length > 0) {
      const counts = countBySeverity(related);
      const files = new Set(related.map((f) => f.file)).size;
      reasons.push(
        `${related.length} actionable finding(s) across ${files} file(s)${counts ? ` — ${counts}` : ''} lower the density score.`,
      );
    } else if (score < 100) {
      reasons.push(
        `AI capped the score at ${score}/100 — complexity or maintainability risk without a directly linked finding.`,
      );
    }
  } else {
    if (related.length > 0) {
      const counts = countBySeverity(related);
      const top = related
        .slice(0, 2)
        .map((f) => `${f.file}${f.line !== null ? `:${f.line}` : ''}`)
        .join(', ');
      reasons.push(
        `${related.length} related finding(s)${counts ? ` (${counts})` : ''}${top ? ` — e.g. ${top}` : ''}.`,
      );
      const criticals = related.filter((f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR').length;
      if (criticals > 0) {
        reasons.push(`${criticals} CRITICAL/MAJOR issue(s) weigh the most on this dimension.`);
      }
    } else if (score < 100) {
      reasons.push(`AI capped the score at ${score}/100 — latent risk in this dimension, no directly linked finding.`);
    }
  }

  if (suggestions.length === 0 && score < 100) {
    return {
      reasons,
      suggestions: GENERIC_SUGGESTIONS[dimension].map((message, i) => ({
        findingId: `generic-${dimension}-${i}`,
        file: '',
        line: null,
        message,
        suggestion: null,
      })),
    };
  }
  return { reasons, suggestions };
}

function countBySeverity(findings: readonly ReviewFinding[]): string {
  const order: readonly ReviewFinding['severity'][] = ['CRITICAL', 'MAJOR', 'MINOR'];
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  return order
    .filter((s) => (counts.get(s) ?? 0) > 0)
    .map((s) => `${counts.get(s)} ${s}`)
    .join(', ');
}

/**
 * Accessible (?) trigger + popover explaining a sub-100 score.
 * Opens on hover, focus, and click (touch friendly); closes on Escape or outside click.
 */
export function ScoreHelp({
  dimension,
  label,
  score,
  findings,
  stats,
  onViewFinding,
}: {
  readonly dimension: ScoreDimensionKey;
  readonly label: string;
  readonly score: number;
  readonly findings: readonly ReviewFinding[];
  readonly stats?: ReviewStats;
  readonly onViewFinding?: (findingId: string) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: PointerEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // Caller guarantees score < 100, but stay safe if reused elsewhere.
  if (score >= 100) return null;

  const explanation = buildDimensionExplanation(dimension, score, findings, stats);
  const points = 100 - score;

  const scheduleClose = (): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const cancelClose = (): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        aria-label={`Why ${label} is ${score}/100?`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={scheduleClose}
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: '1px solid var(--color-border-strong)',
          background: open ? 'var(--color-surface-selected)' : 'var(--color-surface-muted)',
          color: 'var(--color-text-muted)',
          fontSize: '0.7rem',
          fontWeight: 700,
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        ?
      </button>

      {open && (
        <span
          id={popoverId}
          role="dialog"
          aria-label={`Why ${label} scored ${score} out of 100`}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 'min(340px, 80vw)',
            zIndex: 50,
            textAlign: 'left',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-modal)',
            padding: '14px 14px 12px',
            display: 'block',
            fontWeight: 400,
          }}
        >
          <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Why {label} is {score}/100?
          </span>
          <span
            style={{
              display: 'inline-block',
              marginTop: 6,
              fontSize: '0.68rem',
              fontWeight: 600,
              color: 'var(--color-warning)',
              background: 'var(--color-warning-bg)',
              borderRadius: 999,
              padding: '2px 8px',
            }}
          >
            {points} point{points === 1 ? '' : 's'} below perfect
          </span>

          {explanation.reasons.length > 0 && (
            <span style={{ display: 'block', marginTop: 10 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: '0.66rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--color-text-muted)',
                }}
              >
                Reasons
              </span>
              <ul
                style={{
                  margin: '6px 0 0',
                  paddingLeft: 18,
                  fontSize: '0.76rem',
                  color: 'var(--color-text)',
                  lineHeight: 1.5,
                }}
              >
                {explanation.reasons.map((reason) => (
                  <li key={reason} style={{ marginBottom: 4 }}>
                    {reason}
                  </li>
                ))}
              </ul>
            </span>
          )}

          {explanation.suggestions.length > 0 && (
            <span style={{ display: 'block', marginTop: 10 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: '0.66rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--color-text-muted)',
                }}
              >
                How to gain points
              </span>
              <ol
                style={{
                  margin: '6px 0 0',
                  paddingLeft: 18,
                  fontSize: '0.76rem',
                  color: 'var(--color-text)',
                  lineHeight: 1.5,
                }}
              >
                {explanation.suggestions.map((s) => (
                  <li key={s.findingId} style={{ marginBottom: 6 }}>
                    {s.file !== '' && (
                      <span
                        style={{
                          display: 'block',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.68rem',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {s.file}
                        {s.line !== null ? `:${s.line}` : ''}
                      </span>
                    )}
                    <span style={{ display: 'block' }}>{s.message}</span>
                    {s.suggestion !== null && s.suggestion !== '' && (
                      <span style={{ display: 'block', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        Fix: {s.suggestion}
                      </span>
                    )}
                    {s.file !== '' && onViewFinding !== undefined && (
                      <button
                        type="button"
                        onClick={() => {
                          onViewFinding(s.findingId);
                          setOpen(false);
                        }}
                        style={{
                          marginTop: 4,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          color: 'var(--color-info)',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        View finding
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </span>
          )}

          <span
            style={{
              display: 'block',
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid var(--color-border)',
              fontSize: '0.66rem',
              color: 'var(--color-text-faint)',
              lineHeight: 1.4,
            }}
          >
            Correlated from findings in this PR — the numeric score is AI-assessed, the list above shows the local
            evidence behind it.
          </span>
        </span>
      )}
    </span>
  );
}
