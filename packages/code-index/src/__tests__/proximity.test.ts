import { describe, expect, it } from 'vitest';

import { buildGraph } from '../graph.js';
import { indexFiles } from '../indexer.js';
import {
  DEP_DIRECT,
  DEP_TARGET,
  DEP_TRANSITIVE,
  DEP_UNRELATED,
  dependencyProximity,
} from '../proximity.js';

/** utils ← feature ← page, plus an unrelated standalone file. */
function fixtureGraph() {
  const files = new Map<string, string>([
    ['src/utils.ts', 'export const add = (a: number, b: number) => a + b;\n'],
    ['src/feature.ts', "import { add } from './utils';\n"],
    ['src/page.ts', "import './feature';\n"],
    ['src/standalone.ts', 'export const unused = 1;\n'],
  ]);
  return buildGraph(indexFiles(files));
}

describe('dependencyProximity (day-27 §2.3, §2.4)', () => {
  const graph = fixtureGraph();

  it('is 1.0 for a changed file itself and 0.6 for its direct importer', () => {
    expect(dependencyProximity(['src/utils.ts'], 'src/utils.ts', graph)).toBe(DEP_TARGET);
    expect(dependencyProximity(['src/utils.ts'], 'src/feature.ts', graph)).toBe(DEP_DIRECT);
  });

  it('is 0.3 for a transitive importer (distance ≥ 2)', () => {
    expect(dependencyProximity(['src/utils.ts'], 'src/page.ts', graph)).toBe(DEP_TRANSITIVE);
  });

  it('is 0.1 for an indexed but unrelated file', () => {
    expect(dependencyProximity(['src/utils.ts'], 'src/standalone.ts', graph)).toBe(DEP_UNRELATED);
  });

  it('returns null (cold) for a candidate with no graph entry — not a hard 0', () => {
    expect(dependencyProximity(['src/utils.ts'], 'src/notIndexed.ts', graph)).toBeNull();
  });

  it('is 0.1 for an indexed candidate when no changed file was indexed or named', () => {
    expect(dependencyProximity([], 'src/feature.ts', graph)).toBe(DEP_UNRELATED);
  });
});
