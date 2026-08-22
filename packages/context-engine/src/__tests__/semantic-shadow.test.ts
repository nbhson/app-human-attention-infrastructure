import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  contextSourceEmbeddings,
  contexts,
  projects,
  shadowRankComparisons,
  tasks,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { ContextSourceType, newProjectID, newTaskID } from '@harness/domain';
import { EmbeddingIndexer, StubEmbedder } from '@harness/embeddings';

import { FileCollector } from '../collect.js';
import type { CollectedFile } from '../collect.js';
import { ContextEngine } from '../engine.js';
import {
  KeywordDependencyRanker,
  SemanticRanker,
  TiktokenTokenizer,
  kendallTau,
  sha256,
} from '../index.js';

const SCHEMA = 'harness_test_semantic_shadow';

let testDb: TestDb;
let db: DrizzleDB;
let tmpRoot: string;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;

  tmpRoot = mkdtempSync(join(tmpdir(), 'sem-shadow-'));
  mkdirSync(join(tmpRoot, 'src'), { recursive: true });
  mkdirSync(join(tmpRoot, 'node_modules', 'some-lib'), { recursive: true });

  writeFileSync(
    join(tmpRoot, 'src', 'PaymentService.ts'),
    "export class PaymentService {\n  process() {\n    return 'payment processed';\n  }\n}\n",
  );
  writeFileSync(
    join(tmpRoot, 'src', 'UnrelatedUtil.ts'),
    "export const util = () => 'nothing relevant';\n",
  );
  writeFileSync(
    join(tmpRoot, 'src', 'logging.ts'),
    'export function log(msg: string) {\n  console.log(msg);\n}\n',
  );
  writeFileSync(join(tmpRoot, 'node_modules', 'some-lib', 'index.js'), 'module.exports = {};\n');
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(shadowRankComparisons);
  await db.delete(contextSourceEmbeddings);
  await db.delete(contexts);
  await db.delete(tasks);
  await db.delete(projects);
});

async function seedTask(): Promise<ReturnType<typeof newTaskID>> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'sem', repo_path: tmpRoot });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'Fix bug in PaymentService',
    idempotency_key: `${taskId}:0`,
  });
  return taskId;
}

/** Populate the index with a deterministic stub vector per source. */
async function populateIndex(
  stub: StubEmbedder,
  sources: ReadonlyArray<{ sourceId: string; content: string; contentHash?: string }>,
): Promise<void> {
  const indexer = new EmbeddingIndexer(db, stub);
  await indexer.run(
    sources.map((source) => ({
      sourceId: source.sourceId,
      sourceType: ContextSourceType.File,
      contentHash: source.contentHash ?? sha256(source.content),
      content: source.content,
    })),
    Math.max(sources.length, 1),
  );
}

async function shadowRows(contextId: string) {
  return db
    .select()
    .from(shadowRankComparisons)
    .where(eq(shadowRankComparisons.context_id, contextId));
}

describe('kendallTau (day-18 §2.4)', () => {
  it('returns 1 for identical order and -1 for reversed', () => {
    expect(kendallTau(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
    expect(kendallTau(['a', 'b', 'c'], ['c', 'b', 'a'])).toBe(-1);
  });

  it('returns null when fewer than two sources are shared', () => {
    expect(kendallTau(['a', 'b'], ['b', 'c'])).toBeNull();
    expect(kendallTau(['a'], ['a'])).toBeNull();
  });
});

describe('SemanticRanker (day-18 §2.3)', () => {
  it('excludes a stale vector whose content_hash no longer matches (day-17 §2.4)', async () => {
    const stub = new StubEmbedder(1536, 'test-model');
    const files: CollectedFile[] = [
      { sourceId: 'src/fresh.ts', content: 'fresh content' },
      { sourceId: 'src/stale.ts', content: 'current content' },
    ];
    await populateIndex(stub, [
      { sourceId: 'src/fresh.ts', content: 'fresh content' },
      // Stored vector is of "current content" but recorded under an outdated hash.
      { sourceId: 'src/stale.ts', content: 'current content', contentHash: 'outdated-hash' },
    ]);

    const ranked = await new SemanticRanker(db, stub).rank('query text', ['src/fresh.ts'], files);

    const ids = ranked.map((file) => file.sourceId);
    expect(ids).toContain('src/fresh.ts');
    expect(ids).not.toContain('src/stale.ts');
  });

  it('never drops a target file even when it has no fresh vector', async () => {
    const stub = new StubEmbedder(1536, 'test-model');
    const files: CollectedFile[] = [
      { sourceId: 'src/a.ts', content: 'alpha file' },
      { sourceId: 'src/b.ts', content: 'beta file' },
      { sourceId: 'src/c.ts', content: 'gamma file' },
    ];
    await populateIndex(stub, [{ sourceId: 'src/a.ts', content: 'alpha file' }]);

    const ranked = await new SemanticRanker(db, stub).rank('query', ['src/b.ts'], files);

    const ids = ranked.map((file) => file.sourceId);
    expect(ids).toContain('src/a.ts'); // the single fresh vector still present
    expect(ids).toContain('src/b.ts'); // target preserved even with no signal
    expect(ids).not.toContain('src/c.ts'); // non-target without a vector is dropped

    const target = ranked.find((file) => file.sourceId === 'src/b.ts');
    expect(target?.relevanceScore).toBe(-1);
  });
});

describe('ContextEngine.resolveWithShadow (day-18 §2.2, §2.3)', () => {
  it('serves keyword rank_method AND records the comparison when the flag is ON', async () => {
    const stub = new StubEmbedder(1536, 'test-model');
    const files = await new FileCollector(tmpRoot).collect();
    await populateIndex(
      stub,
      files.map((file) => ({ sourceId: file.sourceId, content: file.content })),
    );

    const engine = new ContextEngine(
      db,
      new FileCollector(tmpRoot),
      new KeywordDependencyRanker(),
      new TiktokenTokenizer(),
      stub,
      new SemanticRanker(db, stub),
    );
    const taskId = await seedTask();

    const snapshot = await engine.resolveWithShadow({
      taskId,
      taskDescription: 'Fix bug in PaymentService.ts',
      requirements: '',
      targetFiles: ['src/PaymentService.ts'],
      maxTokens: 4000,
      semanticShadowEnabled: true,
    });

    // §2.3 invariant: the served rank_method is NEVER semantic.
    expect(snapshot.rankMethod).toBe('phase1-keyword-dependency');

    const rows = await shadowRows(snapshot.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyword_order).toEqual(expect.any(Array));
    expect(rows[0]?.keyword_order).toContain('src/PaymentService.ts');
    expect(rows[0]?.semantic_order).toContain('src/PaymentService.ts');
    // All three source files are indexed and fresh → both orders cover all of them,
    // and the excluded node_modules path never appears in either.
    expect(rows[0]?.keyword_order).toHaveLength(3);
    expect(rows[0]?.semantic_order).toHaveLength(3);
    expect(rows[0]?.semantic_order?.some((id) => id.includes('node_modules'))).toBe(false);

    const tau = Number(rows[0]?.rank_correlation);
    expect(Number.isFinite(tau)).toBe(true);
    expect(tau).toBeGreaterThanOrEqual(-1);
    expect(tau).toBeLessThanOrEqual(1);
  });

  it('is inert by default — zero embed calls and no comparison row (flag OFF)', async () => {
    const stub = new StubEmbedder(1536, 'test-model');
    const files = await new FileCollector(tmpRoot).collect();
    await populateIndex(
      stub,
      files.map((file) => ({ sourceId: file.sourceId, content: file.content })),
    );
    const querySpy = vi.spyOn(stub, 'embedQuery');

    const engine = new ContextEngine(
      db,
      new FileCollector(tmpRoot),
      new KeywordDependencyRanker(),
      new TiktokenTokenizer(),
      stub,
      new SemanticRanker(db, stub),
    );
    const taskId = await seedTask();

    const snapshot = await engine.resolveWithShadow({
      taskId,
      taskDescription: 'Fix bug in PaymentService.ts',
      requirements: '',
      targetFiles: ['src/PaymentService.ts'],
      maxTokens: 4000,
      // semanticShadowEnabled intentionally omitted
    });

    expect(querySpy).not.toHaveBeenCalled();
    expect(await shadowRows(snapshot.id)).toHaveLength(0);
  });
});
