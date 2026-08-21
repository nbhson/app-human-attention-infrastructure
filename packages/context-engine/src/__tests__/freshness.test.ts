import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ContextSourceType,
  createContextSnapshot,
  createContextSource,
  newContextID,
  newTaskID,
} from '@harness/domain';
import type { ContextSnapshot } from '@harness/domain';

import { checkFreshness, sha256 } from '../freshness.js';

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ctx-freshness-'));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function source(sourceId: string, content: string): ContextSnapshot['sources'][number] {
  return createContextSource({
    type: ContextSourceType.File,
    sourceId,
    relevanceScore: 1,
    content,
    tokenCount: Math.ceil(content.length / 4),
    contentHash: sha256(content),
  });
}

function snapshot(sources: ContextSnapshot['sources']): ContextSnapshot {
  return createContextSnapshot({
    id: newContextID(),
    taskId: newTaskID(),
    sources,
    totalTokens: sources.reduce((sum, s) => sum + s.tokenCount, 0),
    rankMethod: 'phase1-keyword-dependency',
  });
}

describe('checkFreshness', () => {
  it('reports FRESH when every source matches its on-disk content', async () => {
    writeFileSync(join(tmpRoot, 'a.ts'), 'const a = 1;\n');
    const result = await checkFreshness(snapshot([source('a.ts', 'const a = 1;\n')]), tmpRoot);

    expect(result.freshness).toBe('FRESH');
    expect(result.staleSources).toEqual([]);
  });

  it('reports STALE with the edited path when a source changes', async () => {
    writeFileSync(join(tmpRoot, 'a.ts'), 'const a = 1;\n');
    writeFileSync(join(tmpRoot, 'b.ts'), 'const b = 2;\n');
    const snap = snapshot([source('a.ts', 'const a = 1;\n'), source('b.ts', 'const b = 2;\n')]);

    writeFileSync(join(tmpRoot, 'a.ts'), 'const a = 999;\n');

    const result = await checkFreshness(snap, tmpRoot);

    expect(result.freshness).toBe('STALE');
    expect(result.staleSources).toEqual(['a.ts']);
  });

  it('reports STALE when a source file has been deleted', async () => {
    writeFileSync(join(tmpRoot, 'gone.ts'), 'export const x = 1;\n');
    const snap = snapshot([source('gone.ts', 'export const x = 1;\n')]);

    rmSync(join(tmpRoot, 'gone.ts'), { force: true });

    const result = await checkFreshness(snap, tmpRoot);

    expect(result.freshness).toBe('STALE');
    expect(result.staleSources).toEqual(['gone.ts']);
  });
});
