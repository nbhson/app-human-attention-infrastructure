import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseVitestJson } from '../parse-vitest-json.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/vitest-json', import.meta.url));

function fixture(name: string): string {
  return readFileSync(new URL(`${name}.json`, `file://${FIXTURES}/`), 'utf8');
}

describe('parseVitestJson', () => {
  it('parses a passing suite into PASSED leaf rows', () => {
    const results = parseVitestJson(fixture('pass'));
    expect(results).toEqual([
      {
        testFile: '/worktree/src/add.test.ts',
        testName: 'add > sums two numbers',
        status: 'PASSED',
        durationMs: 2,
      },
      {
        testFile: '/worktree/src/add.test.ts',
        testName: 'add > handles zero',
        status: 'PASSED',
        durationMs: 1,
      },
    ]);
  });

  it('parses a failing suite, attaching the failure message and stack', () => {
    const results = parseVitestJson(fixture('fail'));
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ testName: 'add > sums two numbers', status: 'PASSED' });
    expect(results[1]).toMatchObject({ testName: 'add > rejects overflow', status: 'FAILED' });
    expect(results[1]?.error).toContain('AssertionError: expected Infinity not to be 1');
  });

  it('maps pending and todo tests to SKIPPED', () => {
    const results = parseVitestJson(fixture('skip'));
    expect(results).toEqual([
      {
        testFile: '/worktree/src/subtract.test.ts',
        testName: 'subtract > subtracts two numbers',
        status: 'SKIPPED',
        durationMs: 0,
      },
      {
        testFile: '/worktree/src/subtract.test.ts',
        testName: 'subtract > a TODO test',
        status: 'SKIPPED',
        durationMs: 0,
      },
    ]);
  });

  it('returns [] for malformed JSON instead of throwing', () => {
    expect(parseVitestJson('not json at all')).toEqual([]);
  });

  it('returns [] for a report with no testResults array (killed/partial file)', () => {
    expect(parseVitestJson('{}')).toEqual([]);
    expect(parseVitestJson('{"testResults": null}')).toEqual([]);
  });
});
