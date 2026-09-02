import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { abExperiments, abRuns } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import type { Logger } from '@harness/di';
import { uuidv7 } from '@harness/domain';

import { DbRankDefaultProvider, RANK_METHOD_HYBRID, RANK_METHOD_KEYWORD } from '../retrieval/retriever-factory.js';

const SCHEMA = 'harness_test_db_rank_default';

const noopLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => noopLogger,
};

let testDb: TestDb;
let db: DrizzleDB;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await db.delete(abRuns);
  await db.delete(abExperiments);
});

async function seedRun(report: Record<string, unknown>): Promise<void> {
  const experimentId = uuidv7();
  await db.insert(abExperiments).values({
    id: experimentId,
    variant_a: {},
    variant_b: {},
    metric: 'context_acceptance_rate',
  });
  await db.insert(abRuns).values({
    id: uuidv7(),
    experiment_id: experimentId,
    variant_id: 'B',
    metric_value: 1,
    report: { variantId: 'B', metric: 'context_acceptance_rate', ...report },
  });
}

describe('DbRankDefaultProvider', () => {
  it('returns hybrid when the latest arm-B run promotes hybrid', async () => {
    await seedRun({ rankMethod: 'hybrid', recommendation: 'promote' });
    const resolver = new DbRankDefaultProvider(() => db, noopLogger);
    expect(await resolver.resolveDefaultRankMethod()).toBe(RANK_METHOD_HYBRID);
  });

  it('degrades to keyword when the run does not promote', async () => {
    await seedRun({ rankMethod: 'hybrid', recommendation: 'keep-shadow' });
    const resolver = new DbRankDefaultProvider(() => db, noopLogger);
    expect(await resolver.resolveDefaultRankMethod()).toBe(RANK_METHOD_KEYWORD);
  });

  it('degrades to keyword when no rows exist', async () => {
    const resolver = new DbRankDefaultProvider(() => db, noopLogger);
    expect(await resolver.resolveDefaultRankMethod()).toBe(RANK_METHOD_KEYWORD);
  });

  it('degrades to keyword when the promoted method is not hybrid', async () => {
    await seedRun({ rankMethod: 'semantic', recommendation: 'promote' });
    const resolver = new DbRankDefaultProvider(() => db, noopLogger);
    expect(await resolver.resolveDefaultRankMethod()).toBe(RANK_METHOD_KEYWORD);
  });

  it('falls back to env resolver when the DB throws', async () => {
    const broken = {
      select: () => ({
        from: () => {
          throw new Error('boom');
        },
      }),
    } as never;
    const resolver = new DbRankDefaultProvider(() => broken, noopLogger);
    await expect(resolver.resolveDefaultRankMethod()).resolves.toBe(RANK_METHOD_KEYWORD);
  });
});
