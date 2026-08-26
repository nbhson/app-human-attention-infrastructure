import { describe, expect, it } from 'vitest';

import { parseReviewOutput, ReviewParseError } from '../review/parse-review.js';

const VALID = JSON.stringify({
  summary: 'Looks good.',
  overallVerdict: 'APPROVE',
  findings: [
    {
      severity: 'MAJOR',
      file: 'src/a.ts',
      line: 4,
      message: 'a bug',
      suggestion: 'keep it null-safe',
    },
  ],
  suggestions: [{ file: 'src/a.ts', hunk: '@@ -1 +1 @@', proposed: 'x = 1', rationale: 'correct' }],
});

describe('parseReviewOutput', () => {
  it('parses a valid review object', () => {
    const out = parseReviewOutput(VALID);

    expect(out.summary).toBe('Looks good.');
    expect(out.overallVerdict).toBe('APPROVE');
    expect(out.findings).toEqual([
      {
        severity: 'MAJOR',
        kind: 'correctness',
        file: 'src/a.ts',
        line: 4,
        message: 'a bug',
        suggestion: 'keep it null-safe',
      },
    ]);
    expect(out.suggestions).toEqual([
      { file: 'src/a.ts', hunk: '@@ -1 +1 @@', proposed: 'x = 1', rationale: 'correct' },
    ]);
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n' + VALID + '\n```';
    expect(parseReviewOutput(fenced).summary).toBe('Looks good.');
  });

  it('extracts the first JSON object from surrounding prose', () => {
    const prose = `Here is my review:\n\n${VALID}\n\nI hope this helps.`;
    expect(parseReviewOutput(prose).summary).toBe('Looks good.');
  });

  it('clamps unknown verdict and severity to safe defaults', () => {
    const dirty = JSON.stringify({
      summary: '',
      overallVerdict: 'DO_THE_THING',
      findings: [{ severity: 'FUZZY', file: 'src/a.ts', message: 'm' }],
      suggestions: [],
    });

    const out = parseReviewOutput(dirty);
    expect(out.overallVerdict).toBe('COMMENT');
    expect(out.findings[0]?.severity).toBe('INFO');
  });

  it('keeps a valid cleanup kind and clamps an unknown kind to correctness', () => {
    const out = parseReviewOutput(
      JSON.stringify({
        summary: '',
        overallVerdict: 'COMMENT',
        findings: [
          { severity: 'NIT', kind: 'cleanup', file: 'src/dead.ts', message: 'unused' },
          { severity: 'MAJOR', kind: 'FUZZY', file: 'src/b.ts', message: 'b' },
          { severity: 'MAJOR', file: 'src/c.ts', message: 'c' },
        ],
        suggestions: [],
      }),
    );

    expect(out.findings).toEqual([
      { severity: 'NIT', kind: 'cleanup', file: 'src/dead.ts', message: 'unused' },
      { severity: 'MAJOR', kind: 'correctness', file: 'src/b.ts', message: 'b' },
      { severity: 'MAJOR', kind: 'correctness', file: 'src/c.ts', message: 'c' },
    ]);
  });

  it('drops findings missing a file or message', () => {
    const out = parseReviewOutput(
      JSON.stringify({
        summary: '',
        overallVerdict: 'COMMENT',
        findings: [
          { severity: 'MAJOR', file: '', message: '' },
          { severity: 'MAJOR', file: 'x', message: 'ok' },
        ],
        suggestions: 'not-an-array',
      }),
    );

    expect(out.findings).toEqual([
      { severity: 'MAJOR', kind: 'correctness', file: 'x', message: 'ok' },
    ]);
    expect(out.suggestions).toEqual([]);
  });

  it('coerces a string line number to a number', () => {
    const out = parseReviewOutput(
      JSON.stringify({
        summary: '',
        overallVerdict: 'COMMENT',
        findings: [
          { severity: 'MAJOR', file: 'src/a.ts', line: '42', message: 'a bug' },
          { severity: 'MINOR', file: 'src/b.ts', line: ' 17 ', message: 'b bug' },
          { severity: 'INFO', file: 'src/c.ts', line: 'line 9', message: 'c note' },
        ],
        suggestions: [],
      }),
    );

    expect(out.findings).toEqual([
      { severity: 'MAJOR', kind: 'correctness', file: 'src/a.ts', line: 42, message: 'a bug' },
      { severity: 'MINOR', kind: 'correctness', file: 'src/b.ts', line: 17, message: 'b bug' },
      { severity: 'INFO', kind: 'correctness', file: 'src/c.ts', message: 'c note' },
    ]);
  });

  it('throws ReviewParseError on non-JSON', () => {
    expect(() => parseReviewOutput('definitely not json {')).toThrow(ReviewParseError);
  });
});
