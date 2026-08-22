/**
 * Persistence tests for `ReportStore` (day-07 §3.2).
 *
 * Uses an isolated Postgres schema so the round-trip and the append-only
 * immutability guarantee (a re-run of the same window + source_version violates
 * the UNIQUE constraint) are exercised against the real schema, not a mock.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { ReportStore } from '../report-store.js';
import type { EvaluationReport } from '../report.js';

const SCHEMA = 'harness_test_report_store';
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

function report(from: string, to: string, precision: number): EvaluationReport {
  return {
    window: { from, to },
    generatedAt: '2026-08-18T06:00:00.000Z',
    lines: [
      {
        key: 'routing.precision',
        value: precision,
        previousValue: undefined,
        delta: undefined,
        trend: 'UNKNOWN',
      },
    ],
    // Day-25 sections are always present on a generated report; a hand-built
    // fixture just uses the honest empty defaults.
    shadow: { comparisons: 0 },
    infra: {},
    rankMethod: 'keyword',
  };
}

describe('ReportStore', () => {
  it('inserts a report and lists it back for its window', async () => {
    const store = new ReportStore(testDb.db);

    const id = await store.insert(report('2026-08-11', '2026-08-18', 0.8), 'v0.2.0-harness');

    const rows = await store.listByWindow(new Date('2026-08-10'), new Date('2026-08-19'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.sourceVersion).toBe('v0.2.0-harness');
    expect(rows[0]?.report.lines[0]?.value).toBe(0.8);
  });

  it('filters the listing to the requested window', async () => {
    const store = new ReportStore(testDb.db);
    await store.insert(report('2026-08-04', '2026-08-11', 0.7), 'v0.2.0-harness');

    // A disjoint window returns nothing.
    const none = await store.listByWindow(new Date('2026-07-01'), new Date('2026-07-08'));
    expect(none).toHaveLength(0);
  });

  it('rejects a duplicate (window, source_version) instead of re-writing history', async () => {
    const store = new ReportStore(testDb.db);
    const same = report('2026-09-01', '2026-09-08', 0.8);

    await store.insert(same, 'v0.2.0-harness'); // first insert succeeds
    await expect(store.insert(same, 'v0.2.0-harness')).rejects.toThrow();
  });
});
