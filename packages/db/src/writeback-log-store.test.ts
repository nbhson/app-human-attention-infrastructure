import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GitProviderType, WritebackAction } from '@harness/domain';
import type { WritebackClaim } from '@harness/domain';

import { createTestDb, destroyTestDb, type TestDb } from './__tests__/helpers.js';
import { reviewDecisions, reviewReports, writebackLog } from './schema/index.js';
import { DrizzleWritebackLogStore } from './writeback-log-store.js';

const SCHEMA = 'harness_test_writeback';
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

/** Read every row for a dedup key, keyed by row id, so assertions are order-independent. */
async function rowsFor(dedupKey: string) {
  const rows = await testDb.db.select().from(writebackLog).where(eq(writebackLog.dedup_key, dedupKey));
  return rows;
}

function claim(overrides: Partial<WritebackClaim> = {}): WritebackClaim {
  return {
    intentId: 'wb-1',
    provider: GitProviderType.GitHub,
    externalId: '42',
    action: WritebackAction.Comment,
    body: 'LGTM',
    dedupKey: 'dedup-1',
    ...overrides,
  };
}

describe('DrizzleWritebackLogStore', () => {
  it('claim → finalize SUCCEEDED; a retried claim is duplicate', async () => {
    const store = new DrizzleWritebackLogStore(testDb.db);
    const key = 'dedup-retry';

    const first = await store.claim(claim({ intentId: 'wb-1', dedupKey: key }));
    expect(first).toBe('claimed');

    await store.finalize({ intentId: 'wb-1', status: 'SUCCEEDED', externalRef: 'comment-1' });

    const retry = await store.claim(claim({ intentId: 'wb-2', dedupKey: key }));
    expect(retry).toBe('duplicate');

    const rows = await rowsFor(key);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['wb-1']?.status).toBe('SUCCEEDED');
    expect(byId['wb-1']?.external_ref).toBe('comment-1');
    expect(byId['wb-2']?.status).toBe('DUPLICATE');
    expect(rows.filter((r) => r.status === 'SUCCEEDED')).toHaveLength(1);
  });

  it('a concurrent identical PENDING claim is blocked at claim time (day-36 §2.1)', async () => {
    const store = new DrizzleWritebackLogStore(testDb.db);
    const key = 'dedup-race';

    // The first claim records PENDING and owns the in-flight slot.
    expect(await store.claim(claim({ intentId: 'wb-a', dedupKey: key }))).toBe('claimed');

    // A second, identical intent — racing before the first finalizes — must not
    // proceed: the in-flight index scopes to PENDING+SUCCEEDED, so this resolver
    // loses and returns 'duplicate' *before any external call* (day-36 §2.1).
    expect(await store.claim(claim({ intentId: 'wb-b', dedupKey: key }))).toBe('duplicate');

    await store.finalize({ intentId: 'wb-a', status: 'SUCCEEDED', externalRef: 'comment-a' });

    const rows = await rowsFor(key);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['wb-a']?.status).toBe('SUCCEEDED');
    expect(byId['wb-b']?.status).toBe('DUPLICATE');
    expect(rows.filter((r) => r.status === 'SUCCEEDED')).toHaveLength(1);
  });

  it('a FAILED attempt leaves the in-flight index, so a retry may claim again', async () => {
    const store = new DrizzleWritebackLogStore(testDb.db);
    const key = 'dedup-fail-retry';

    expect(await store.claim(claim({ intentId: 'wb-fail-a', dedupKey: key }))).toBe('claimed');
    await store.finalize({ intentId: 'wb-fail-a', status: 'FAILED', error: 'host unreachable' });

    // FAILED is outside the PENDING/SUCCEEDED scope, so the retry is not a dup.
    expect(await store.claim(claim({ intentId: 'wb-fail-b', dedupKey: key }))).toBe('claimed');
    await store.finalize({ intentId: 'wb-fail-b', status: 'SUCCEEDED', externalRef: 'comment-2' });

    const rows = await rowsFor(key);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['wb-fail-a']?.status).toBe('FAILED');
    expect(byId['wb-fail-b']?.status).toBe('SUCCEEDED');
  });

  it('finalize FAILED records the (redacted) error', async () => {
    const store = new DrizzleWritebackLogStore(testDb.db);
    const key = 'dedup-fail';

    await store.claim(claim({ intentId: 'wb-fail', dedupKey: key }));
    await store.finalize({ intentId: 'wb-fail', status: 'FAILED', error: 'host unreachable' });

    const rows = await rowsFor(key);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('FAILED');
    expect(rows[0]?.error).toBe('host unreachable');
  });

  it('a duplicate claim records a DUPLICATE row without a finalize', async () => {
    const store = new DrizzleWritebackLogStore(testDb.db);
    const key = 'dedup-dup-only';

    await store.claim(claim({ intentId: 'wb-x', dedupKey: key }));
    await store.finalize({ intentId: 'wb-x', status: 'SUCCEEDED' });
    expect(await store.claim(claim({ intentId: 'wb-y', dedupKey: key }))).toBe('duplicate');

    const rows = await rowsFor(key);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['wb-y']?.status).toBe('DUPLICATE');
  });

  it('a claim with a decisionId records the decision_id linkage (day-09 §3.2)', async () => {
    // Seed the parent rows so the FK (decision_id → review_decisions.id) resolves
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
      overall_verdict: 'APPROVE',
      pr_payload: {},
    });
    await testDb.db.insert(reviewDecisions).values({
      id: 'dec-9',
      report_id: 'rep-1',
      decision: 'APPROVE',
      writeback_enabled: false,
    });

    const store = new DrizzleWritebackLogStore(testDb.db);
    const key = 'dedup-decision';

    await store.claim(claim({ intentId: 'wb-d', dedupKey: key, decisionId: 'dec-9' }));

    const rows = await rowsFor(key);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision_id).toBe('dec-9');
  });
});
