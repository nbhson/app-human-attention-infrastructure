import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GitProviderType, WritebackAction } from '@harness/domain';
import type { WritebackClaim } from '@harness/domain';

import { createTestDb, destroyTestDb, type TestDb } from './__tests__/helpers.js';
import { writebackLog } from './schema/index.js';
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
  const rows = await testDb.db
    .select()
    .from(writebackLog)
    .where(eq(writebackLog.dedup_key, dedupKey));
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

  it('two PENDING claims racing to SUCCEEDED: the loser degrades to DUPLICATE', async () => {
    const store = new DrizzleWritebackLogStore(testDb.db);
    const key = 'dedup-race';

    expect(await store.claim(claim({ intentId: 'wb-a', dedupKey: key }))).toBe('claimed');
    expect(await store.claim(claim({ intentId: 'wb-b', dedupKey: key }))).toBe('claimed');

    // Both wrote PENDING and both "succeed" externally; the partial unique index
    // admits only one SUCCEEDED per key, so the later finalize degrades.
    await store.finalize({ intentId: 'wb-a', status: 'SUCCEEDED', externalRef: 'comment-a' });
    await store.finalize({ intentId: 'wb-b', status: 'SUCCEEDED', externalRef: 'comment-b' });

    const rows = await rowsFor(key);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(rows.filter((r) => r.status === 'SUCCEEDED')).toHaveLength(1);
    expect([byId['wb-a']?.status, byId['wb-b']?.status]).toEqual(
      expect.arrayContaining(['SUCCEEDED', 'DUPLICATE']),
    );
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
});
