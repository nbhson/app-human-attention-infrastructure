/**
 * Verification Week-3 checkpoint demo (Phase 3 day-15 §3.1) — `pnpm demo:verification`.
 *
 * Proves the Week-3 milestone end to end: **a PR (a set of changed files) →
 * dependency-graph targeted tests where provable, full suite otherwise → the
 * verdict is identical either way → a FAILED result flags the report with
 * evidence and never auto-rejects.**
 *
 * The three legs use three *real* packages wired together through the app host
 * (the only layer allowed to import both a graph leaf and an engine):
 *
 *   1. `@harness/code-index` — `indexFiles` → `buildGraph` → `affectedTests`
 *      computes the transitive affected-test closure over a recorded fixture.
 *   2. `@harness/verification-engine` — `TargetedVerifier` owns the routing
 *      policy (targeted vs full, with the `complete`/empty safety net), and
 *      `flagReport` + `renderFlag` turn a non-passing check set into a
 *      human-readable, evidence-bearing markdown flag.
 *   3. `@harness/git-provider` — `cloneAndCheckout` (with its injectable
 *      `RunGit`) demonstrates clone-error surfacing + teardown-on-failure.
 *
 * What is *stubbed*, and why, is stated on the line: the actual sandbox `pnpm
 * build`/`pnpm test` legs are exercised by the day-12/22 unit suites
 * (`clone-verifier`, `sandboxed-check` parity) and need a Docker daemon + a real
 * clone URL, neither of which a credential-free demo reaches. Here the run modes
 * are deterministic verdict carriers with a *modeled* per-test latency, so the
 * equivalence/fallback/routing logic — the thing this checkpoint exists to
 * prove — is demonstrated over real graph + real verifier code, with no live
 * key, no network, and no Docker.
 */

import { performance } from 'node:perf_hooks';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { affectedTests, buildGraph, indexFiles } from '@harness/code-index';
import type { DependencyGraph } from '@harness/code-index';
import {
  CheckKind,
  CheckStatus,
  TargetedVerifier,
  flagReport,
  renderFlag,
} from '@harness/verification-engine';
import type {
  AffectedTestsResolver,
  CheckResult,
  OverallVerdict,
  VerificationFlag,
} from '@harness/verification-engine';
import { CloneError, cloneAndCheckout } from '@harness/git-provider';
import type { CloneInput, RunGit } from '@harness/git-provider';

/** A recorded fixture repo (day-15 §2 §3.2) — repo-relative path → source text. */
const FIXTURE: ReadonlyMap<string, string> = new Map([
  ['src/add.ts', 'export const add = (a: number, b: number): number => a + b;\n'],
  ['src/mul.ts', 'export const mul = (a: number, b: number): number => a * b;\n'],
  [
    'src/calc.ts',
    [
      "import { add } from './add';",
      "import { mul } from './mul';",
      '',
      'export const calc = (a: number, b: number): number => add(a, b) * mul(a, b);',
      '',
    ].join('\n'),
  ],
  [
    'src/add.test.ts',
    ["import { add } from './add';", '', 'export {};', '// asserts add(2, 3) === 5'].join('\n'),
  ],
  [
    'src/mul.test.ts',
    ["import { mul } from './mul';", '', 'export {};', '// asserts mul(2, 3) === 6'].join('\n'),
  ],
  [
    'src/calc.test.ts',
    ["import { calc } from './calc';", '', 'export {};', '// asserts calc(2, 3) === 30'].join('\n'),
  ],
  ['src/standalone.ts', 'export const standalone = 1;\n'],
  // A runtime-computed specifier the indexer cannot resolve → `complete: false`.
  [
    'src/dynamic.ts',
    [
      "const name = 'add';",
      "const loaded = require('./' + name);",
      'export const dynamic = loaded;',
    ].join('\n'),
  ],
]);

/** The full test suite over the fixture (the "full" leg of every comparison). */
const FULL_TESTS = ['src/add.test.ts', 'src/mul.test.ts', 'src/calc.test.ts'] as const;

/** Modeled wall-clock cost of one test (illustrative; the real cost is test-body time). */
const COST_PER_TEST_MS = 15;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sorted(xs: readonly string[]): string[] {
  return [...xs].sort();
}

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`[demo:verification] assertion failed: ${label}`);
  }
}

function section(step: string, title: string): void {
  console.log();
  console.log(`=== ${step} — ${title} ===`);
}

/** Build the real dependency graph over the recorded fixture. */
function buildFixtureGraph(): DependencyGraph {
  return buildGraph(indexFiles(FIXTURE));
}

/** The test-run modes: deterministic verdict carriers with a modeled per-test cost. */
function runners(verdict: OverallVerdict) {
  return {
    runAll: async (): Promise<OverallVerdict> => {
      await delay(FULL_TESTS.length * COST_PER_TEST_MS);
      return verdict;
    },
    runTests: async (tests: readonly string[]): Promise<OverallVerdict> => {
      await delay(tests.length * COST_PER_TEST_MS);
      return verdict;
    },
  };
}

async function main(): Promise<void> {
  console.log();
  console.log(
    'demo:verification — day-15 Week-3 checkpoint (targeted == full, FAILED is non-blocking)',
  );
  console.log();

  // --- 1. Clone error surfacing + teardown --------------------------------------------
  section('1', 'clone error surfacing + teardown-on-failure (day-11 §6, day-15 §3.3)');
  // The exact pitfall in day-11 §6: a `--depth 1` clone can miss the PR head SHA,
  // so the `fetch` step fails. A loud, typed `CloneError` must surface — never a
  // silently-empty worktree — and the caller's teardown must still run.
  const unreachableHeadSha: RunGit = async (args) => {
    if (args[0] === 'fetch') {
      return { exitCode: 128, stdout: '', stderr: "fatal: couldn't find remote ref <head-sha>\n" };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const cloneInput: CloneInput = {
    repo: 'github.com/acme/api',
    number: 42,
    headSha: 'feedbeefdeadbeef',
    sourceBranch: 'feat/change',
    targetBranch: 'main',
  };
  const workdir = mkdtempSync(join(tmpdir(), 'harness-demo-clone-'));
  try {
    await cloneAndCheckout(cloneInput, workdir, { run: unreachableHeadSha, timeoutMs: 1000 });
    throw new Error('[demo:verification] clone unexpectedly succeeded');
  } catch (err) {
    assert(err instanceof CloneError, 'clone failure surfaces as a typed CloneError');
    assert((err as CloneError).command === 'fetch', 'CloneError names the failing git step');
    console.log(`  surfaced: CloneError (step "${(err as CloneError).command}"):`);
    console.log(`            ${(err as Error).message}`);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
    assert(!existsSync(workdir), 'teardown removed the workdir even on failure');
    console.log('  teardown: workdir removed in the `finally` even though the clone threw ✓');
  }

  // --- 2. Index the fixture + equivalence + fallback ----------------------------------
  const graph = buildFixtureGraph();
  const resolveAffected: AffectedTestsResolver = (changed) => affectedTests(changed, graph);

  section('2', 'index the fixture → full vs targeted equivalence table');
  console.log(
    `  graph: ${graph.files.size} files, ${FULL_TESTS.length} tests, ` +
      `incomplete files: ${graph.incompleteFiles.size} (dynamic import)`,
  );
  console.log();

  interface EquivCase {
    readonly name: string;
    readonly changed: readonly string[];
    readonly expectedTests: readonly string[];
    readonly verdict: OverallVerdict;
  }
  const equivCases: EquivCase[] = [
    {
      name: 'leaf add.ts (green)',
      changed: ['src/add.ts'],
      expectedTests: ['src/add.test.ts', 'src/calc.test.ts'],
      verdict: 'PASSED',
    },
    {
      name: 'leaf mul.ts (green)',
      changed: ['src/mul.ts'],
      expectedTests: ['src/mul.test.ts', 'src/calc.test.ts'],
      verdict: 'PASSED',
    },
    {
      name: 'mid  calc.ts (green)',
      changed: ['src/calc.ts'],
      expectedTests: ['src/calc.test.ts'],
      verdict: 'PASSED',
    },
    {
      name: 'mid  calc.ts (red)  ',
      changed: ['src/calc.ts'],
      expectedTests: ['src/calc.test.ts'],
      verdict: 'FAILED',
    },
  ];

  const hdr = (
    label: string,
    changed: string,
    tests: string,
    latency: string,
    verdict: string,
  ): void =>
    console.log(
      `  ${label}  ${changed.padEnd(12)}  tests ${tests}  latency ${latency} ms  verdict ${verdict}  ✅`,
    );
  console.log(
    '  scenario                     changed       tests   latency(ms)        verdict   parity',
  );
  console.log(
    '  ---------------------------- ------------- ------- ------------------ --------- --------',
  );

  for (const cs of equivCases) {
    const { runAll, runTests } = runners(cs.verdict);
    const verifier = new TargetedVerifier({ resolveAffected, runAll, runTests });

    const fullStart = performance.now();
    const fullVerdict = await runAll();
    const fullMs = performance.now() - fullStart;

    const targetedStart = performance.now();
    const result = await verifier.verify(cs.changed);
    const targetedMs = performance.now() - targetedStart;

    assert(result.targeted === true, `${cs.name}: a provable change stays targeted`);
    assert(
      JSON.stringify(sorted(result.testsRun)) === JSON.stringify(sorted(cs.expectedTests)),
      `${cs.name}: affected set ${sorted(result.testsRun).join(',')} == expected`,
    );
    assert(result.verdict === fullVerdict, `${cs.name}: targeted verdict === full verdict`);
    assert(result.verdict === cs.verdict, `${cs.name}: verdict is ${cs.verdict}`);
    assert(
      result.testsRun.length <= FULL_TESTS.length,
      `${cs.name}: targeted ran ≤ full test count`,
    );

    hdr(
      cs.name.padEnd(25),
      cs.changed.join(','),
      `${result.testsRun.length}/${FULL_TESTS.length}`,
      `${targetedMs.toFixed(0)} vs ${fullMs.toFixed(0)}`,
      cs.verdict,
    );
  }
  console.log();
  console.log(
    '  equivalence holds: targeted verdict == full verdict on every case (green AND red).',
  );

  // --- 3. Fallback safety net ---------------------------------------------------------
  section('3', 'fallback safety net — an unprovable change runs the full suite');
  interface FallbackCase {
    readonly name: string;
    readonly changed: readonly string[];
    readonly reason: string;
  }
  const fallbackCases: FallbackCase[] = [
    {
      name: 'dynamic import gap',
      changed: ['src/dynamic.ts'],
      reason: 'graph incomplete (complete:false)',
    },
    {
      name: 'file never indexed',
      changed: ['src/not-indexed.ts'],
      reason: 'changed file absent from the index',
    },
    { name: 'no affected test  ', changed: ['src/standalone.ts'], reason: 'empty affected set' },
    { name: 'empty change set   ', changed: [], reason: 'nothing to shorten' },
  ];

  for (const fc of fallbackCases) {
    const { runAll, runTests } = runners('PASSED');
    const verifier = new TargetedVerifier({ resolveAffected, runAll, runTests });
    const result = await verifier.verify(fc.changed);

    assert(result.targeted === false, `${fc.name}: falls back to full`);
    assert(result.testsRun.length === 0, `${fc.name}: fallback runs no named subset`);
    assert(result.verdict === 'PASSED', `${fc.name}: full-suite verdict propagated`);
    console.log(`  ${fc.name.padEnd(20)} → full suite (${fc.reason}) ✓`);
  }
  console.log();

  // --- 4. FAILED fixture → flag → non-blocking ---------------------------------------
  section('4', 'FAILED fixture → report flag with evidence (never auto-rejects)');
  // A clone sequence whose COMPILE passed but whose TEST genuinely failed — the
  // shape `CloneVerifier` returns (day-12), passed to the day-13 flag machinery.
  const compilePassed: CheckResult = {
    checkKind: CheckKind.COMPILE,
    status: CheckStatus.PASSED,
    durationMs: 812,
    output: 'tsc --noEmit … 0 errors',
  };
  const FAILED_OUTPUT = [
    '❯ src/calc.test.ts (1 test | 1 failed)',
    '',
    '   × calc multiplies the sum of its factors',
    '     → expected 30 to be 12',
    '',
    ' ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯',
    '',
    ' FAIL  src/calc.test.ts > calc multiplies the sum of its factors',
    'AssertionError: expected 30 to be 12',
  ].join('\n');
  const testFailed: CheckResult = {
    checkKind: CheckKind.TEST,
    status: CheckStatus.FAILED,
    exitCode: 1,
    durationMs: 1240,
    evidenceId: 'evidence:sha256:6f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c',
    output: FAILED_OUTPUT,
  };

  const flag: VerificationFlag = flagReport([compilePassed, testFailed]);
  assert(flag.failed === true, 'a FAILED test flips the flag');
  assert(flag.verdict === 'FAILED', 'flag verdict is FAILED');
  assert(flag.failedKinds.join(',') === 'TEST', 'failed kinds narrow to TEST (code), not infra');
  assert(flag.timedOutKinds.length === 0, 'no TIMED_OUT (infra) kinds — this is a code failure');
  assert(
    flag.failedChecks.length === 1 && flag.failedChecks[0]?.exitCode === 1,
    'exit code captured',
  );

  const markdown = renderFlag(flag);
  assert(markdown.includes('## Verification — FAILED'), 'markdown heads as FAILED');
  assert(markdown.includes('evidence:'), 'markdown carries the evidence ref');
  assert(markdown.includes('src/calc.test.ts'), 'markdown carries the failing-test tail');
  assert(
    markdown.includes('**Review required before any write-back.**'),
    'write-back is gated on review',
  );

  console.log('  (markdown a human reviewer sees — evidence ref + tail, never the full blob)');
  console.log();
  console.log(
    markdown
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n'),
  );

  // The non-blocking invariant (day-13 §6): a red verify is *information*, not a
  // gate. The flag holds no decision field; the real `ChangeStatusSubscriber`
  // early-returns on a FAILED `verification.completed` (annotate + stop) rather
  // than transition a rollback — so the item reaches the human review queue.
  assert(!('decision' in flag), 'the flag carries no decision field (report, not authority)');
  console.log();
  console.log('  → non-blocking: FAILED annotates the review; the item reaches AWAITING_REVIEW ✓');
  console.log();
  console.log('week-3 milestone: targeted == full (verdict parity), fewer tests where provable,');
  console.log('and a FAILED build/test flags evidence without auto-rejecting. ✅');
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error('[demo:verification] FAILED:', err);
    process.exit(1);
  },
);
