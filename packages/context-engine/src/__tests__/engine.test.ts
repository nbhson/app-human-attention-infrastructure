import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { contexts, projects, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { newProjectID, newTaskID } from '@harness/domain';

import { FileCollector } from '../collect.js';
import { ContextEngine } from '../engine.js';

const SCHEMA = 'harness_test_context_engine';

let testDb: TestDb;
let db: DrizzleDB;
let tmpRoot: string;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;

  tmpRoot = mkdtempSync(join(tmpdir(), 'ctx-engine-'));
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
  await db.delete(contexts);
  await db.delete(tasks);
  await db.delete(projects);
});

async function seedTask(): Promise<string> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'ctx', repo_path: tmpRoot });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'Fix bug in PaymentService',
    idempotency_key: `${taskId}:0`,
  });
  return taskId;
}

describe('ContextEngine.resolveContext', () => {
  it('resolves a ranked, budgeted snapshot and persists it for provenance', async () => {
    const taskId = (await seedTask()) as ReturnType<typeof newTaskID>;
    const engine = new ContextEngine(db, new FileCollector(tmpRoot));

    const snapshot = await engine.resolveContext({
      taskId,
      taskDescription: 'Fix bug in PaymentService.ts',
      requirements: '',
      targetFiles: ['src/PaymentService.ts'],
      maxTokens: 4000,
    });

    const ids = snapshot.sources.map((s) => s.sourceId);
    expect(ids).toContain('src/PaymentService.ts');
    expect(ids.some((id) => id.includes('node_modules'))).toBe(false);
    expect(snapshot.totalTokens).toBeLessThanOrEqual(4000);
    expect(snapshot.rankMethod).toBe('phase1-keyword-dependency');

    const target = snapshot.sources.find((s) => s.sourceId === 'src/PaymentService.ts');
    const sibling = snapshot.sources.find((s) => s.sourceId === 'src/UnrelatedUtil.ts');
    expect(target).toBeDefined();
    expect(target!.relevanceScore).toBeGreaterThanOrEqual(sibling?.relevanceScore ?? -1);

    const rows = await db.select().from(contexts).where(eq(contexts.id, snapshot.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.task_id).toBe(taskId);
    expect(rows[0]?.rank_method).toBe('phase1-keyword-dependency');
  });

  it('still resolves a non-empty snapshot when no target file is named', async () => {
    const taskId = (await seedTask()) as ReturnType<typeof newTaskID>;
    const engine = new ContextEngine(db, new FileCollector(tmpRoot));

    const snapshot = await engine.resolveContext({
      taskId,
      taskDescription: 'Add logging to all API endpoints',
      requirements: '',
      targetFiles: [],
      maxTokens: 4000,
    });

    expect(snapshot.sources.length).toBeGreaterThan(0);
  });
});

describe('ContextEngine.resolveFresh', () => {
  it('re-resolves only the stale source and leaves the rest untouched', async () => {
    const taskId = (await seedTask()) as ReturnType<typeof newTaskID>;
    const engine = new ContextEngine(db, new FileCollector(tmpRoot));

    const request = {
      taskId,
      taskDescription: 'Fix bug in PaymentService.ts',
      requirements: '',
      targetFiles: ['src/PaymentService.ts'],
      maxTokens: 4000,
    };
    const snapshot = await engine.resolveContext(request);
    const staleContent =
      'export class PaymentService {\n  process() {\n    return "updated!";\n  }\n}\n';

    // Mid-flight edit to a single source, then refresh.
    writeFileSync(join(tmpRoot, 'src', 'PaymentService.ts'), staleContent);
    const { freshness, snapshot: patched } = await engine.resolveFresh(request, snapshot);

    expect(freshness.freshness).toBe('STALE');
    expect(freshness.staleSources).toEqual(['src/PaymentService.ts']);

    const patchedPayment = patched.sources.find((s) => s.sourceId === 'src/PaymentService.ts');
    expect(patchedPayment!.content).toBe(staleContent);

    // Non-stale sources are byte-for-byte the originals.
    const originalLogging = snapshot.sources.find((s) => s.sourceId === 'src/logging.ts');
    const patchedLogging = patched.sources.find((s) => s.sourceId === 'src/logging.ts');
    expect(patchedLogging?.content).toBe(originalLogging!.content);
    expect(patchedLogging?.metadata.refreshed).toBeUndefined();
  });
});
