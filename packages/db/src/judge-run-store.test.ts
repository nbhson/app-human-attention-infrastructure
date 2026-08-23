import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { brand, newJudgeRunID } from '@harness/domain';
import type { JudgeRun, JudgeScores } from '@harness/domain';

import { createTestDb, destroyTestDb, type TestDb } from './__tests__/helpers.js';
import { judgeRuns, reviewReports } from './schema/index.js';
import { DrizzleJudgeRunStore } from './judge-run-store.js';

const SCHEMA = 'harness_test_judge';
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

/** A complete judge run against the seeded `rep-1` report. */
function aRun(scores?: Partial<JudgeScores>): JudgeRun {
  return {
    id: newJudgeRunID(),
    reportId: brand('rep-1', 'ReviewReportID'),
    prUrl: 'https://github.com/acme/api/pull/1',
    promptVersion: 'judge-rubric-v1',
    model: 'test-model',
    temperature: 0.2,
    reportHash: 'abc123def456',
    scores: {
      severityAgreement: 0.9,
      routingAgreement: 0.8,
      evidenceSufficiency: 0.95,
      overall: 0.87,
      ...scores,
    },
    reasoning: 'severity and routing agree; evidence is strong',
    createdAt: new Date(),
  };
}

describe('DrizzleJudgeRunStore', () => {
  it('records a judge run and persists every audited field (day-21 §2.3)', async () => {
    // Seed the parent report so the FK (report_id → review_reports.id) resolves
    // in the isolated schema.
    await testDb.db.insert(reviewReports).values({
      id: 'rep-1',
      pr_url: 'https://github.com/acme/api/pull/1',
      pr_number: 1,
      repo: 'github.com/acme/api',
      pr_title: 'seed',
      ai_provider: 'anthropic',
      model: 'test-model',
      summary: 'seed report',
      overall_verdict: 'REQUEST_CHANGES',
      pr_payload: {},
    });

    const store = new DrizzleJudgeRunStore(testDb.db);
    await store.record(aRun());

    const rows = await testDb.db.select().from(judgeRuns).where(eq(judgeRuns.report_id, 'rep-1'));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row!.prompt_version).toBe('judge-rubric-v1');
    expect(row!.model).toBe('test-model');
    expect(row!.temperature).toBeCloseTo(0.2);
    expect(row!.report_hash).toBe('abc123def456');
    expect(row!.severity_agreement).toBeCloseTo(0.9);
    expect(row!.routing_agreement).toBeCloseTo(0.8);
    expect(row!.evidence_sufficiency).toBeCloseTo(0.95);
    expect(row!.overall).toBeCloseTo(0.87);
    expect(row!.reasoning).toMatch(/evidence is strong/);
  });
});
