import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newJudgeRunID } from '@harness/domain';
import type { JudgeAgreementRecord } from '@harness/domain';

import { createTestDb, destroyTestDb, type TestDb } from './__tests__/helpers.js';
import { DrizzleJudgeAgreementStore } from './judge-agreement-store.js';
import { judgeAgreements } from './schema/index.js';

const SCHEMA = 'harness_test_judge_agreement';
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

/** A complete agreement computation over two matched run pairs. */
function aRecord(): JudgeAgreementRecord {
  return {
    aRunIds: [newJudgeRunID(), newJudgeRunID()],
    bRunIds: [newJudgeRunID(), newJudgeRunID()],
    reportHashes: ['hash-aaaa', 'hash-bbbb'],
    agreement: {
      severity: { n: 2, meanAbsDiff: 0.1, agreement: 0.9, kappa: 0.8 },
      routing: { n: 2, meanAbsDiff: 0.2, agreement: 0.8, kappa: 0.6 },
      evidence: { n: 2, meanAbsDiff: 0.05, agreement: 0.95, kappa: 1 },
      overall: { n: 2, meanAbsDiff: 0.12, agreement: 0.88, kappa: 0.7 },
    },
    createdAt: new Date(),
  };
}

describe('DrizzleJudgeAgreementStore', () => {
  it('persists run ids, hashes, and per-dimension agreement + kappa (day-22 §2.4)', async () => {
    const store = new DrizzleJudgeAgreementStore(testDb.db);
    await store.record(aRecord());

    const rows = await testDb.db.select().from(judgeAgreements);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row!.n).toBe(2);
    expect(row!.run_a_ids).toHaveLength(2);
    expect(row!.run_b_ids).toHaveLength(2);
    expect(row!.report_hashes).toEqual(['hash-aaaa', 'hash-bbbb']);
    expect(row!.severity_agreement).toBeCloseTo(0.9);
    expect(row!.severity_kappa).toBeCloseTo(0.8);
    expect(row!.routing_agreement).toBeCloseTo(0.8);
    expect(row!.routing_kappa).toBeCloseTo(0.6);
    expect(row!.evidence_agreement).toBeCloseTo(0.95);
    expect(row!.evidence_kappa).toBeCloseTo(1);
    expect(row!.overall_agreement).toBeCloseTo(0.88);
    expect(row!.overall_kappa).toBeCloseTo(0.7);
  });
});
