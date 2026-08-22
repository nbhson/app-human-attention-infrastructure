import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { contextSourceCache } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { FileCollector } from '../collect.js';
import { PostgresContextCache } from '../cache/context-cache.js';
import type { ContextCache } from '../cache/context-cache.js';
import { sha256 } from '../freshness.js';

const SCHEMA = 'harness_test_ctx_concurrency';

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
  await db.delete(contextSourceCache);
});

/** A cache that counts misses and gates (and counts) writes — no DB, no reads. */
function gatedCache() {
  let getByStatCount = 0;
  let setCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const cache: ContextCache = {
    get: async () => null,
    getByStat: async () => {
      getByStatCount += 1;
      return null;
    },
    set: async () => {
      setCount += 1;
      await gate;
    },
    invalidate: async () => {},
    stats: async () => ({ hits: 0, misses: 0, entries: 0 }),
  };

  return {
    cache,
    getByStatCount: (): number => getByStatCount,
    setCount: (): number => setCount,
    release: (): void => release(),
  };
}

/** Yield the event loop until `condition()` is true (bounded, no `vi` timer). */
async function flushUntil(condition: () => boolean, maxTurns = 1000): Promise<void> {
  for (let i = 0; i < maxTurns && !condition(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('FileCollector single-flight (day-26 §2.4, §3.4)', () => {
  it('single-flights N concurrent collect() of one source into one read+set', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ctx-conc-collect-'));
    writeFileSync(join(tmp, 'Only.ts'), 'export class Only {}\n');
    const gated = gatedCache();
    const collector = new FileCollector(tmp, gated.cache);

    try {
      const N = 8;
      const all = Promise.all(Array.from({ length: N }, () => collector.collect()));

      // Let every caller clear the miss fast-path so they all pile onto the one
      // in-flight load, then release the write gate.
      await flushUntil(() => gated.getByStatCount() >= N);
      await new Promise((resolve) => setTimeout(resolve, 0)); // flush inFlight checks
      gated.release();

      const batches = await all;
      for (const files of batches) {
        expect(files.map((f) => f.sourceId)).toEqual(['Only.ts']);
      }
      // The stampede collapsed to a single read+set, not N.
      expect(gated.setCount()).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('PostgresContextCache concurrency (day-26 §2.4)', () => {
  const entry = {
    sourceId: 'src/a.ts',
    contentHash: sha256('hello'),
    content: 'hello',
    mtimeMs: 1,
    size: 5,
  };

  it('N concurrent set() of the same source collapse to one row (single-flight + upsert)', async () => {
    const cache = new PostgresContextCache(db);

    await Promise.all(Array.from({ length: 8 }, () => cache.set(entry)));

    expect((await cache.stats()).entries).toBe(1);
    const hit = await cache.get(entry.sourceId, entry.contentHash);
    expect(hit?.content).toBe('hello');
  });
});
