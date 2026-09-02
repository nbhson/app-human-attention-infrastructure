import { describe, expect, it } from 'vitest';

import { affectedTests } from '../affected.js';
import { buildGraph } from '../graph.js';
import { indexFiles, isTestFile } from '../indexer.js';

/** A tiny fixture monorepo: `feature` imports `utils`; its test imports both. */
function fixture(): Map<string, string> {
  return new Map<string, string>([
    ['src/utils.ts', 'export function add(a: number, b: number): number { return a + b; }\n'],
    ['src/feature.ts', "import { add } from './utils';\nexport function feature(): number { return add(1, 2); }\n"],
    ['src/feature.test.ts', "import { feature } from './feature';\nimport { add } from './utils';\n"],
    // Nothing imports this file, and it imports nothing.
    ['src/standalone.ts', 'export const unused = 1;\n'],
  ]);
}

/** Index + build the graph from a fixture. */
function graphOf(files: Map<string, string>) {
  return buildGraph(indexFiles(files));
}

describe('code-index (day-14 §3)', () => {
  it('indexes static, re-export, dynamic, and require specifiers into edges', () => {
    const files = new Map<string, string>([
      ['src/a.ts', ''],
      ['src/b.ts', ''],
      ['src/c.ts', ''],
      [
        'src/everything.ts',
        [
          "import { a } from './a';",
          "export { b } from './b';",
          "const c = () => import('./c');",
          "const r = require('./c');",
        ].join('\n'),
      ],
    ]);
    const indexed = indexFiles(files).get('src/everything.ts');

    expect(indexed?.complete).toBe(true);
    const targets = new Set(indexed?.edges.map((e) => e.to) ?? []);
    expect(targets).toEqual(new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']));
  });

  it('marks a file with a dynamic-import variable, a variable require, or a bare package as incomplete', () => {
    const dynamic = new Map([['src/dyn.ts', "const m = import('./' + name);\n"]]);
    const requireVar = new Map([['src/req.ts', 'const m = require(someVar);\n']]);
    const bare = new Map([['src/bare.ts', "import { eq } from '@harness/db';\n"]]);

    expect(indexFiles(dynamic).get('src/dyn.ts')?.complete).toBe(false);
    expect(indexFiles(requireVar).get('src/req.ts')?.complete).toBe(false);
    expect(indexFiles(bare).get('src/bare.ts')?.complete).toBe(false);
  });

  it('isTestFile recognizes *.test/*.spec and __tests__ paths', () => {
    expect(isTestFile('src/thing.test.ts')).toBe(true);
    expect(isTestFile('src/thing.spec.tsx')).toBe(true);
    expect(isTestFile('src/__tests__/x.ts')).toBe(true);
    expect(isTestFile('src/thing.ts')).toBe(false);
  });

  it('computes the transitive affected tests for a changed leaf', () => {
    const graph = graphOf(fixture());

    const result = affectedTests(['src/utils.ts'], graph);

    expect(result.complete).toBe(true);
    expect([...result.tests].sort()).toEqual(['src/feature.test.ts']);
  });

  it('includes an unchanged importer chain and the changed test itself', () => {
    const graph = graphOf(fixture());

    // A changed test maps to itself; a changed standalone maps to no tests.
    expect(affectedTests(['src/feature.test.ts'], graph)).toMatchObject({
      tests: ['src/feature.test.ts'],
      complete: true,
    });
    expect(affectedTests(['src/standalone.ts'], graph)).toMatchObject({
      tests: [],
      complete: true,
    });
  });

  it('falls back (complete:false) when the walk hits an incomplete file', () => {
    const files = fixture();
    // `feature` still imports `utils` (so a utils change reaches it) *and* now
    // imports a bare package → incomplete; its test imports feature.
    files.set(
      'src/feature.ts',
      "import { add } from './utils';\nimport { helper } from 'some-pkg';\nexport function feature() { return helper(add); }\n",
    );
    const graph = graphOf(files);

    expect(affectedTests(['src/utils.ts'], graph).complete).toBe(false);
  });

  it('falls back when a changed file was never indexed', () => {
    const graph = graphOf(fixture());

    const result = affectedTests(['src/not-indexed.ts'], graph);

    expect(result.complete).toBe(false);
    expect(result.tests).toEqual([]);
  });
});
