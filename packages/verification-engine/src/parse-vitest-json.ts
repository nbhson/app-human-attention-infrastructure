/**
 * Vitest JSON-reporter parser (day-16 §2.4).
 *
 * Pure and side-effect free: it turns the JSON blob Vitest writes to
 * `--outputFile` into `ParsedTestResult[]`. It is deliberately *non-throwing* —
 * a partial or absent file (the process was killed, or Vitest bailed before
 * writing) yields `[]`, never an exception that would blow past the engine's
 * level-1 `withTimeout` and turn an infra glitch into a hard crash (§6).
 */

import type { ParsedTestResult } from './types.js';

const ERROR_CAP = 8 * 1024;

/** The subset of the Vitest JSON schema we read (v1 reporter, `--reporter=json`). */
interface VitestAssertionResult {
  readonly fullName: string;
  readonly status?: string;
  readonly duration?: number;
  readonly failureMessages?: string[];
}

interface VitestTestSuiteResult {
  readonly name: string;
  readonly assertionResults?: VitestAssertionResult[];
}

interface VitestJsonReport {
  readonly testResults?: VitestTestSuiteResult[];
}

/** Map a Vitest `assertionResults[].status` string to one of our three persisted states. */
function normalizeStatus(status?: string): ParsedTestResult['status'] {
  switch (status) {
    case 'passed':
      return 'PASSED';
    case 'failed':
      return 'FAILED';
    default:
      // `pending` and `todo` (and anything unexpected) are not failures.
      return 'SKIPPED';
  }
}

/**
 * Parse Vitest's JSON reporter output into per-test results.
 *
 * Returns `[]` for malformed JSON, a truncated/missing file, or a report with
 * no `testResults` array — the caller treats an empty parses as "no leaf rows"
 * rather than throwing into the engine.
 */
export function parseVitestJson(raw: string): ParsedTestResult[] {
  let doc: VitestJsonReport;
  try {
    doc = JSON.parse(raw) as VitestJsonReport;
  } catch {
    return [];
  }
  const suites = doc.testResults;
  if (!Array.isArray(suites)) {
    return [];
  }

  const results: ParsedTestResult[] = [];
  for (const suite of suites) {
    const assertions = suite.assertionResults;
    if (!Array.isArray(assertions)) {
      continue;
    }
    for (const assertion of assertions) {
      const failures = assertion.failureMessages;
      const error =
        Array.isArray(failures) && failures.length > 0 ? failures.join('\n').slice(0, ERROR_CAP) : undefined;
      results.push({
        testFile: suite.name,
        testName: assertion.fullName,
        status: normalizeStatus(assertion.status),
        // Vitest reports a fractional `duration` (e.g. 0.3895ms); the DB column is
        // an integer (`verification_test_results.duration_ms`), so round it here.
        durationMs: typeof assertion.duration === 'number' ? Math.round(assertion.duration) : 0,
        ...(error === undefined ? {} : { error }),
      });
    }
  }
  return results;
}
