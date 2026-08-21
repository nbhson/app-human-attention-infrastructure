import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { evidence, evidenceLinks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { EvidenceKind, EvidenceStore, EvidenceSubjectKind, sha256 } from '../evidence-store.js';

const SCHEMA = 'harness_test_evidence_store';

let testDb: TestDb;
let db: DrizzleDB;
let store: EvidenceStore;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
  store = new EvidenceStore();
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

describe('EvidenceStore', () => {
  it('records an evidence row + link, content-addressed by SHA-256', async () => {
    const body = 'tsc output\n2 errors';
    const result = await store.record(db, EvidenceKind.CheckOutput, body, [
      { subjectKind: EvidenceSubjectKind.CheckResult, subjectId: 'check-1' },
    ]);

    const evidenceRows = await db.select().from(evidence);
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]).toMatchObject({
      id: result.id,
      kind: 'CHECK_OUTPUT',
      body,
      content_hash: sha256(body),
    });

    const links = await db.select().from(evidenceLinks);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      evidence_id: result.id,
      subject_kind: 'check_result',
      subject_id: 'check-1',
    });
  });

  it('writes one link per subject, all pointing at the same evidence row', async () => {
    const result = await store.record(db, EvidenceKind.CheckOutput, 'shared proof', [
      { subjectKind: EvidenceSubjectKind.CheckResult, subjectId: 'check-a' },
      { subjectKind: EvidenceSubjectKind.Report, subjectId: 'report-1' },
    ]);

    const links = await db.select().from(evidenceLinks);
    expect(links).toHaveLength(3); // 1 from the prior test + 2 here
    const forThis = links.filter((link) => link.evidence_id === result.id);
    expect(forThis).toHaveLength(2);
    expect(forThis.map((link) => link.subject_id).sort()).toEqual(['check-a', 'report-1']);
  });

  it('does not truncate a large body (evidence is uncapped)', async () => {
    const large = ('x'.repeat(64) + '\n').repeat(1_024); // 65 * 1024 = 66,560 bytes, above the 64 KB inline cap
    expect(large.length).toBeGreaterThan(64 * 1024);

    const result = await store.record(db, EvidenceKind.CheckOutput, large, []);

    const evidenceRows = await db.select().from(evidence).where(eq(evidence.id, result.id));
    expect(evidenceRows[0]?.body).toBe(large);
    expect(evidenceRows[0]?.body.length).toBe(large.length);
  });

  it('runs inside the caller transaction through the shared executor', async () => {
    await db.transaction(async (tx) => {
      await store.record(tx, EvidenceKind.TestResults, JSON.stringify({ pass: 1 }), [
        { subjectKind: EvidenceSubjectKind.CheckResult, subjectId: 'check-in-tx' },
      ]);
    });

    const rows = await db.select().from(evidence);
    expect(rows.some((row) => row.kind === 'TEST_RESULTS')).toBe(true);
  });
});
