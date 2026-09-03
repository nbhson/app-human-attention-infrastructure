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

    expect(out.findings).toEqual([{ severity: 'MAJOR', kind: 'correctness', file: 'x', message: 'ok' }]);
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

  it('extracts JSON when surrounded by multiple fenced blocks', () => {
    const multiFence = ['```', 'some reasoning here', '```', '```json', VALID, '```', 'And a trailing note.'].join(
      '\n',
    );
    expect(parseReviewOutput(multiFence).summary).toBe('Looks good.');
  });

  it('handles nested braces inside JSON string values', () => {
    const nested = JSON.stringify({
      summary: 'Found an issue with {a: b} syntax',
      overallVerdict: 'COMMENT',
      findings: [],
      suggestions: [],
    });
    expect(parseReviewOutput(nested).summary).toBe('Found an issue with {a: b} syntax');
  });

  it('handles escaped quotes inside string values', () => {
    const escaped = JSON.stringify({
      summary: 'He said "hello" and it broke',
      overallVerdict: 'COMMENT',
      findings: [],
      suggestions: [],
    });
    expect(parseReviewOutput(escaped).summary).toBe('He said "hello" and it broke');
  });

  it('extracts JSON even when followed by orphaned closing fence', () => {
    const orphaned = VALID + '\n\n```';
    expect(parseReviewOutput(orphaned).summary).toBe('Looks good.');
  });

  it('salvages truncated JSON missing closing braces', () => {
    const truncated =
      '{"summary":"Review truncated","overallVerdict":"COMMENT","findings":[{"severity":"MAJOR","file":"src/a.ts","message":"bug"}],"suggestions":[]';
    const out = parseReviewOutput(truncated);
    expect(out.summary).toBe('Review truncated');
    expect(out.overallVerdict).toBe('COMMENT');
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.file).toBe('src/a.ts');
  });

  it('salvages truncated JSON missing closing bracket on findings', () => {
    const truncated =
      '{"summary":"Partial","overallVerdict":"APPROVE","findings":[{"severity":"CRITICAL","file":"src/b.ts","message":"critical issue"}';
    const out = parseReviewOutput(truncated);
    expect(out.summary).toBe('Partial');
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.severity).toBe('CRITICAL');
  });

  it('salvages truncated JSON mid-string value', () => {
    const truncated = '{"summary":"This is a trun';
    const out = parseReviewOutput(truncated);
    expect(out.summary).toBe('This is a trun');
  });

  it('throws ReviewParseError on non-JSON', () => {
    expect(() => parseReviewOutput('definitely not json {')).toThrow(ReviewParseError);
  });

  it('salvages a bare finding object emitted by a fast model', () => {
    const bare = JSON.stringify({
      file: 'index.html',
      line: null,
      severity: 'warning',
      message: 'PR title claims split but diff only adds a stylesheet link.',
    });
    const out = parseReviewOutput(bare);
    expect(out.overallVerdict).toBe('COMMENT');
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.file).toBe('index.html');
    expect(out.findings[0]?.severity).toBe('INFO'); // 'warning' clamps to INFO
    expect(out.findings[0]?.message).toContain('PR title claims split');
  });

  it('salvages a bare array of findings', () => {
    const arr = JSON.stringify([
      { severity: 'CRITICAL', file: 'src/a.ts', message: 'weak auth' },
      { severity: 'MAJOR', file: 'src/b.ts', message: 'null deref' },
    ]);
    const out = parseReviewOutput(arr);
    expect(out.findings).toHaveLength(2);
    expect(out.findings[0]?.severity).toBe('CRITICAL');
    expect(out.findings[1]?.file).toBe('src/b.ts');
  });

  it('unwraps a model that wraps the review under a single key', () => {
    const wrapped = JSON.stringify({
      review: { summary: 'wrapped', overallVerdict: 'APPROVE', findings: [], suggestions: [] },
    });
    const out = parseReviewOutput(wrapped);
    expect(out.summary).toBe('wrapped');
    expect(out.overallVerdict).toBe('APPROVE');
  });

  it('repairs a trailing comma before a closing bracket', () => {
    const bad =
      '{"summary":"s","overallVerdict":"COMMENT","findings":[{"severity":"MAJOR","file":"a","message":"m"},],"suggestions":[]}';
    const out = parseReviewOutput(bad);
    expect(out.findings).toHaveLength(1);
  });

  it('repairs a line-broken fenced JSON with trailing prose', () => {
    const out = parseReviewOutput('```json\n' + VALID + '\n```\n\nReviewed using the shared pipeline.');
    expect(out.summary).toBe('Looks good.');
  });

  it('salvages a run of concatenated bare finding objects (JSONL)', () => {
    const jsonl = [
      '{ "severity": "CRITICAL", "file": "src/a.ts", "message": "weak auth" }',
      '{ "severity": "MAJOR", "file": "src/b.ts", "message": "null deref" }',
      '{ "severity": "NIT", "file": "src/c.ts", "line": 5, "message": "rename" }',
    ].join('\n');
    const out = parseReviewOutput(jsonl);
    expect(out.findings).toHaveLength(3);
    expect(out.findings[0]?.severity).toBe('CRITICAL');
    expect(out.findings[1]?.file).toBe('src/b.ts');
    expect(out.findings[2]?.line).toBe(5);
  });

  it('salvages concatenated findings written inline without newlines', () => {
    const inline =
      '{"severity":"MAJOR","file":"src/x.ts","message":"one"}{"severity":"MINOR","file":"src/y.ts","message":"two"}';
    const out = parseReviewOutput(inline);
    expect(out.findings).toHaveLength(2);
    expect(out.findings[0]?.file).toBe('src/x.ts');
    expect(out.findings[1]?.file).toBe('src/y.ts');
  });

  it('salvages an envelope truncated mid-string inside a nested finding (no stop_reason truncation flag)', () => {
    const truncated = `{
  "summary": "This PR introduces backend routes.",
  "overallVerdict": "REQUEST_CHANGES",
  "findings": [
    {
      "severity": "CRITICAL",
      "kind": "correctness",
      "file": "toeic-reading-be/src/routes/toeic.routes.js",
      "line": 138,
      "message": "The catch block is nested: \`catch (error) { console.error(...) }\` is a syntax error."
    },
    {
      "severity": "MAJOR",
      "kind": "correctness",
      "file": "toeic-reading-be/src/routes/toeic.routes.js",
      "line": 135,
      "message": "Destructures from batches[i]. If null (e.g. [null]) it throws. returning a 400 with a clear me`;
    const out = parseReviewOutput(truncated);
    expect(out.overallVerdict).toBe('REQUEST_CHANGES');
    expect(out.findings.length).toBeGreaterThanOrEqual(1);
    expect(out.findings[0]?.file).toBe('toeic-reading-be/src/routes/toeic.routes.js');
  });
});
