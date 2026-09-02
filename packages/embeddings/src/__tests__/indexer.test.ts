import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { contextSourceEmbeddings } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { ContextSourceType } from '@harness/domain';

import type { Embedder, EmbedQueryResult, EmbedResult } from '../embedder.js';
import { EmbeddingIndexer } from '../indexer.js';
import type { SourceCandidate } from '../indexer.js';
import { StubEmbedder } from '../providers/stub.js';

const SCHEMA = 'harness_test_indexer';

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
  await db.delete(contextSourceEmbeddings);
});

function source(sourceId: string, contentHash: string, content = 'body'): SourceCandidate {
  return { sourceId, sourceType: ContextSourceType.File, contentHash, content };
}

interface Row {
  readonly sourceId: string;
  readonly contentHash: string;
  readonly model: string | null;
  readonly dimensions: number | null;
  readonly truncatedChars: number;
  readonly embeddedAt: Date | null;
}

/** Read rows keyed by source_id; rely on `embedded_at` as the "has a vector" marker. */
async function readRows(): Promise<Row[]> {
  const rows = await db
    .select({
      sourceId: contextSourceEmbeddings.source_id,
      contentHash: contextSourceEmbeddings.content_hash,
      model: contextSourceEmbeddings.model,
      dimensions: contextSourceEmbeddings.dimensions,
      truncatedChars: contextSourceEmbeddings.truncated_chars,
      embeddedAt: contextSourceEmbeddings.embedded_at,
    })
    .from(contextSourceEmbeddings)
    .orderBy(contextSourceEmbeddings.source_id);
  return rows;
}

/** An embedder that always reports a typed, retryable failure (never throws). */
function failingEmbedder(): Embedder {
  const error = { kind: 'embed_error' as const, message: 'provider down', retryable: true };
  return {
    dimensions: 1536,
    model: 'failing-model',
    embed: async (): Promise<EmbedResult> => ({ ok: false, error }),
    embedQuery: async (): Promise<EmbedQueryResult> => ({ ok: false, error }),
  };
}

describe('EmbeddingIndexer.run (day-17 §2.2)', () => {
  it('embeds every source and writes provenance (model / dimensions / embedded_at)', async () => {
    const indexer = new EmbeddingIndexer(db, new StubEmbedder(1536, 'test-model'));

    const progress = await indexer.run([source('src/a.ts', 'hash-a'), source('src/b.ts', 'hash-b')], 2);

    expect(progress).toEqual({ total: 2, embedded: 2, failed: 0, stale: 0 });
    const rows = await readRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.model).toBe('test-model');
      expect(row.dimensions).toBe(1536);
      expect(row.truncatedChars).toBe(0);
      expect(row.embeddedAt).not.toBeNull();
    }
    expect(rows[0]?.contentHash).toBe('hash-a');
    expect(rows[1]?.contentHash).toBe('hash-b');
  });

  it('is idempotent — a fresh re-run is a no-op (no embed call)', async () => {
    const stub = new StubEmbedder(1536, 'test-model');
    const embedSpy = vi.spyOn(stub, 'embed');
    const indexer = new EmbeddingIndexer(db, stub);

    await indexer.run([source('src/a.ts', 'hash-a')], 1);
    const second = await indexer.run([source('src/a.ts', 'hash-a')], 1);

    expect(second).toEqual({ total: 1, embedded: 0, failed: 0, stale: 0 });
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(await readRows()).toHaveLength(1); // still the single row
  });

  it('leaves rows pending on a provider failure, then resumes on the next run', async () => {
    const failing = new EmbeddingIndexer(db, failingEmbedder());
    const failed = await failing.run([source('src/a.ts', 'hash-a'), source('src/b.ts', 'hash-b')], 2);

    expect(failed).toEqual({ total: 2, embedded: 0, failed: 2, stale: 0 });
    const pending = await readRows();
    expect(pending).toHaveLength(2);
    for (const row of pending) {
      expect(row.embeddedAt).toBeNull(); // seeded but not yet embedded
      expect(row.contentHash).toMatch(/^hash-/);
    }

    const resumed = await new EmbeddingIndexer(db, new StubEmbedder(1536, 'test-model')).run(
      [source('src/a.ts', 'hash-a'), source('src/b.ts', 'hash-b')],
      2,
    );
    expect(resumed).toEqual({ total: 2, embedded: 2, failed: 0, stale: 0 });
    const done = await readRows();
    expect(done.every((row) => row.embeddedAt !== null)).toBe(true);
  });

  it('re-embeds a source whose hash changed and reports it as stale', async () => {
    const indexer = new EmbeddingIndexer(db, new StubEmbedder(1536, 'test-model'));

    await indexer.run([source('src/a.ts', 'hash-v1')], 1);
    const progress = await indexer.run([source('src/a.ts', 'hash-v2', 'new body')], 1);

    expect(progress).toEqual({ total: 1, embedded: 1, failed: 0, stale: 1 });
    const [row] = await readRows();
    expect(row).toBeDefined();
    expect(row!.contentHash).toBe('hash-v2');
  });

  it('truncates over-budget content and records the cut on the row', async () => {
    const indexer = new EmbeddingIndexer(db, new StubEmbedder(1536, 'test-model'), {
      maxTokensPerSource: 5, // 20-char budget
    });
    const long = 'x'.repeat(50);

    await indexer.run([source('src/long.ts', 'hash-long', long)], 1);

    const [row] = await readRows();
    expect(row).toBeDefined();
    expect(row!.truncatedChars).toBe(30); // 50 − 20
    expect(row!.embeddedAt).not.toBeNull();
  });

  it('rejects a non-positive batch size before touching the store', async () => {
    const indexer = new EmbeddingIndexer(db, new StubEmbedder(1536, 'test-model'));
    await expect(indexer.run([source('src/a.ts', 'hash-a')], 0)).rejects.toThrow(RangeError);
    expect(await readRows()).toHaveLength(0);
  });
});
