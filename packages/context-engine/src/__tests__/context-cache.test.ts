import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { contextSourceCache } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { FileCollector } from '../collect.js';
import { sha256 } from '../freshness.js';
import { PostgresContextCache } from '../cache/context-cache.js';

const SCHEMA = 'harness_test_context_cache';

let testDb: TestDb;
let db: DrizzleDB;
let cache: PostgresContextCache;
let tmpRoot: string;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
  tmpRoot = mkdtempSync(join(tmpdir(), 'ctx-cache-'));
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(contextSourceCache);
  cache = new PostgresContextCache(db);
});

async function cachedRows(sourceId: string) {
  return db.select().from(contextSourceCache).where(eq(contextSourceCache.source_id, sourceId));
}

describe('PostgresContextCache (day-20 §2.1)', () => {
  it('set → get serves the entry by content_hash (the truth)', async () => {
    await cache.set({
      sourceId: 'src/a.ts',
      contentHash: sha256('hello'),
      content: 'hello',
      mtimeMs: 1000,
      size: 5,
    });

    const hit = await cache.get('src/a.ts', sha256('hello'));
    expect(hit?.content).toBe('hello');
    expect(hit?.sourceId).toBe('src/a.ts');
  });

  it('misses on a content_hash that is not stored', async () => {
    await cache.set({
      sourceId: 'src/a.ts',
      contentHash: sha256('hello'),
      content: 'hello',
      mtimeMs: 1000,
      size: 5,
    });

    expect(await cache.get('src/a.ts', sha256('different'))).toBeNull();
    expect((await cache.stats()).misses).toBe(1);
  });

  it('getByStat hits on a matching (source_id, mtime, size) with zero reads', async () => {
    await cache.set({
      sourceId: 'src/a.ts',
      contentHash: sha256('hello'),
      content: 'hello',
      mtimeMs: 1234.5,
      size: 5,
    });

    expect(await cache.getByStat('src/a.ts', 1234.5, 5)).not.toBeNull();
    expect((await cache.stats()).hits).toBe(1);
  });

  it('getByStat misses when mtime or size drift (stale → re-read)', async () => {
    await cache.set({
      sourceId: 'src/a.ts',
      contentHash: sha256('hello'),
      content: 'hello',
      mtimeMs: 1234.5,
      size: 5,
    });

    expect(await cache.getByStat('src/a.ts', 1234.6, 5)).toBeNull(); // mtime bumped
    expect(await cache.getByStat('src/a.ts', 1234.5, 6)).toBeNull(); // size bumped
    expect((await cache.stats()).misses).toBe(2);
  });

  it('invalidate removes the entry; stats reports the count', async () => {
    await cache.set({
      sourceId: 'src/a.ts',
      contentHash: sha256('hello'),
      content: 'hello',
      mtimeMs: 1000,
      size: 5,
    });
    expect((await cache.stats()).entries).toBe(1);

    await cache.invalidate('src/a.ts');
    expect((await cache.stats()).entries).toBe(0);
    expect(await cache.getByStat('src/a.ts', 1000, 5)).toBeNull();
  });
});

describe('FileCollector with cache (day-20 §5.1)', () => {
  function seedFile(relPath: string, content: string): string {
    const abs = join(tmpRoot, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
    return abs;
  }

  it('serves a hit with zero file reads (chmod 000 still collects)', async () => {
    const content = 'function a(): number { return 1; }\n';
    const abs = seedFile('src/cached.ts', content);
    const collector = new FileCollector(tmpRoot, cache);

    const first = await collector.collect();
    expect(first.map((f) => f.sourceId)).toContain('src/cached.ts');
    expect(await cachedRows('src/cached.ts')).toHaveLength(1);

    // Remove read permission: `stat` still works, but `readFile` would throw
    // EACCES. A hit on the stat fast-path returns the cached content without
    // opening the file, so a second collect still succeeds.
    chmodSync(abs, 0o000);
    try {
      const second = await collector.collect();
      const entry = second.find((f) => f.sourceId === 'src/cached.ts');
      expect(entry?.content).toBe(content);
      expect((await cache.stats()).hits).toBeGreaterThanOrEqual(1);
    } finally {
      chmodSync(abs, 0o644);
    }
  });

  it('re-reads when the file changed (stale stat → miss → fresh content)', async () => {
    seedFile('src/evolving.ts', 'version one');
    const collector = new FileCollector(tmpRoot, cache);

    await collector.collect();
    expect(await cachedRows('src/evolving.ts')).toHaveLength(1);

    // Different size + newer mtime: the stat fast-path must miss and re-read.
    seedFile('src/evolving.ts', 'version two, now longer');
    const second = await collector.collect();

    const entry = second.find((f) => f.sourceId === 'src/evolving.ts');
    expect(entry?.content).toBe('version two, now longer');
    expect((await cache.stats()).misses).toBeGreaterThanOrEqual(1);
  });

  it('caches source content only — never a serialised snapshot', async () => {
    seedFile('src/plain.ts', 'const x = 1;\n');
    const collector = new FileCollector(tmpRoot, cache);
    await collector.collect();

    const rows = await cachedRows('src/plain.ts');
    expect(rows).toHaveLength(1);
    // The stored content is the raw file text, keyed by source_id — not a
    // snapshot payload (no `sources` array, no task id, no "snapshot" shape).
    expect(rows[0]?.content).toBe('const x = 1;\n');
    expect(rows[0]?.content_hash).toBe(sha256('const x = 1;\n'));
    expect(rows[0]?.source_id).toBe('src/plain.ts');
  });
});
