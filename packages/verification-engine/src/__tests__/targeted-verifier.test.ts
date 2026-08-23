import { describe, expect, it, vi } from 'vitest';

import { TargetedVerifier } from '../targeted-verifier.js';
import type { AffectedTestsResolver, TargetedVerifierOptions } from '../targeted-verifier.js';

/** A resolver that returns a fixed affected set + completeness. */
function resolver(tests: readonly string[], complete: boolean): AffectedTestsResolver {
  return () => ({ tests, complete });
}

/** Wire a verifier whose two run modes are recorded spies. */
function subject(
  tests: readonly string[],
  complete: boolean,
  overrides: Partial<TargetedVerifierOptions> = {},
) {
  const runAll = vi.fn(async () => 'PASSED' as const);
  const runTests = vi.fn(async () => 'PASSED' as const);
  const verifier = new TargetedVerifier({
    resolveAffected: resolver(tests, complete),
    runAll,
    runTests,
    ...overrides,
  });
  return { verifier, runAll, runTests };
}

describe('TargetedVerifier (day-14 §3.5)', () => {
  it('runs only the affected tests for a leaf change (targeted)', async () => {
    const { verifier, runAll, runTests } = subject(['src/feature.test.ts'], true);

    const result = await verifier.verify(['src/utils.ts']);

    expect(result.targeted).toBe(true);
    expect(result.testsRun).toEqual(['src/feature.test.ts']);
    expect(result.verdict).toBe('PASSED');
    expect(runTests).toHaveBeenCalledOnce();
    expect(runTests).toHaveBeenCalledWith(['src/feature.test.ts']);
    expect(runAll).not.toHaveBeenCalled();
  });

  it('falls back to the full suite when the graph is incomplete (gap)', async () => {
    const { verifier, runAll, runTests } = subject([], false);

    const result = await verifier.verify(['src/dynamic.ts']);

    expect(result.targeted).toBe(false);
    expect(result.testsRun).toEqual([]);
    expect(runAll).toHaveBeenCalledOnce();
    expect(runTests).not.toHaveBeenCalled();
  });

  it('falls back when a change maps to no tests (cannot prove them irrelevant)', async () => {
    const { verifier, runAll, runTests } = subject([], true);

    const result = await verifier.verify(['src/standalone.ts']);

    expect(result.targeted).toBe(false);
    expect(runAll).toHaveBeenCalledOnce();
    expect(runTests).not.toHaveBeenCalled();
  });

  it('falls back when nothing changed at all', async () => {
    const { verifier, runAll, runTests } = subject(['src/x.test.ts'], true);

    const result = await verifier.verify([]);

    expect(result.targeted).toBe(false);
    expect(runAll).toHaveBeenCalledOnce();
    expect(runTests).not.toHaveBeenCalled();
  });

  it('propagates the verdict of whichever mode ran (equivalence)', async () => {
    const runAll = vi.fn(async () => 'PASSED' as const);
    const runTests = vi.fn(async () => 'FAILED' as const);
    const verifier = new TargetedVerifier({
      resolveAffected: (files) =>
        files.includes('src/not-indexed.ts')
          ? { tests: [], complete: false }
          : { tests: ['src/a.test.ts'], complete: true },
      runAll,
      runTests,
    });

    const targeted = await verifier.verify(['src/a.ts']);
    expect(targeted.verdict).toBe('FAILED');

    const fallback = await verifier.verify(['src/not-indexed.ts']);
    expect(fallback.verdict).toBe('PASSED');
  });
});
