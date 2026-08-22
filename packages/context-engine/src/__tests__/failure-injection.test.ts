import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { contexts, projects, shadowRankComparisons, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { newProjectID, newTaskID } from '@harness/domain';
import type { TaskID } from '@harness/domain';
import { EmbeddingUnavailableError } from '@harness/embeddings';
import type { EmbedQueryResult, EmbedResult, Embedder } from '@harness/embeddings';
import { resetInfraCounters, snapshotInfraCounters } from '@harness/observability';

import { FileCollector } from '../collect.js';
import { ContextEngine } from '../engine.js';
import { KeywordDependencyRanker, SemanticRanker, TiktokenTokenizer } from '../index.js';

const SCHEMA = 'harness_test_ctx_failure_injection';

let testDb: TestDb;
let db: DrizzleDB;
let tmpRoot: string;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;

  tmpRoot = mkdtempSync(join(tmpdir(), 'ctx-failure-injection-'));
  mkdirSync(join(tmpRoot, 'src'), { recursive: true });
  writeFileSync(join(tmpRoot, 'src', 'PaymentService.ts'), 'export class PaymentService {}\n');
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  resetInfraCounters();
  await db.delete(shadowRankComparisons);
  await db.delete(contexts);
  await db.delete(tasks);
  await db.delete(projects);
});

/** An embedder that *throws* — a misbehaving (or injected-failing) provider. */
class ThrowingEmbedder implements Embedder {
  readonly dimensions = 1536;
  readonly model = 'failing-model';
  embed(): Promise<EmbedResult> {
    return Promise.reject(new EmbeddingUnavailableError('provider down'));
  }
  embedQuery(): Promise<EmbedQueryResult> {
    return Promise.reject(new EmbeddingUnavailableError('provider down'));
  }
}

/** An embedder that returns the typed `!ok` failure (the day-16 contract path). */
class TypedFailureEmbedder implements Embedder {
  readonly dimensions = 1536;
  readonly model = 'failing-model';
  embed(): Promise<EmbedResult> {
    return Promise.resolve({
      ok: false,
      error: { kind: 'embed_error', message: 'provider down', retryable: true },
    });
  }
  embedQuery(): Promise<EmbedQueryResult> {
    return Promise.resolve({
      ok: false,
      error: { kind: 'embed_error', message: 'provider down', retryable: true },
    });
  }
}

async function seedTask(): Promise<ReturnType<typeof newTaskID>> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'fi', repo_path: tmpRoot });
  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'Fix PaymentService',
    idempotency_key: `${taskId}:0`,
  });
  return taskId;
}

function request(taskId: TaskID) {
  return {
    taskId,
    taskDescription: 'Fix bug in PaymentService.ts',
    requirements: '',
    targetFiles: ['src/PaymentService.ts'],
    maxTokens: 4000,
    semanticShadowEnabled: true,
  };
}

describe('ContextEngine vector-index failure injection (day-26 §3.1)', () => {
  it('serves keyword and counts the fallback when the embedder throws', async () => {
    const engine = new ContextEngine(
      db,
      new FileCollector(tmpRoot),
      new KeywordDependencyRanker(),
      new TiktokenTokenizer(),
      new ThrowingEmbedder(),
      new SemanticRanker(db, new ThrowingEmbedder()),
    );
    const taskId = await seedTask();

    const snapshot = await engine.resolveWithShadow(request(taskId));

    expect(snapshot.rankMethod).toBe('phase1-keyword-dependency');
    expect(snapshot.sources.length).toBeGreaterThan(0);
    expect(snapshotInfraCounters().semanticFallbacks).toBe(1);
  });

  it('counts the fallback for a typed `!ok` embedder too (never throws)', async () => {
    const engine = new ContextEngine(
      db,
      new FileCollector(tmpRoot),
      new KeywordDependencyRanker(),
      new TiktokenTokenizer(),
      new TypedFailureEmbedder(),
      new SemanticRanker(db, new TypedFailureEmbedder()),
    );
    const taskId = await seedTask();

    const snapshot = await engine.resolveWithShadow(request(taskId));

    expect(snapshot.rankMethod).toBe('phase1-keyword-dependency');
    expect(snapshotInfraCounters().semanticFallbacks).toBe(1);
  });

  it('leaves the counter at zero when the semantic shadow is off', async () => {
    const engine = new ContextEngine(
      db,
      new FileCollector(tmpRoot),
      new KeywordDependencyRanker(),
      new TiktokenTokenizer(),
      new ThrowingEmbedder(),
      new SemanticRanker(db, new ThrowingEmbedder()),
    );
    const taskId = await seedTask();

    const snapshot = await engine.resolveWithShadow({
      ...request(taskId),
      semanticShadowEnabled: false,
    });

    expect(snapshot.rankMethod).toBe('phase1-keyword-dependency');
    expect(snapshotInfraCounters().semanticFallbacks).toBe(0);
  });
});
