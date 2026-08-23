/**
 * `TargetedVerifier` (day-14 §3.5) — run only the affected tests, or fall back.
 *
 * Where the full `VerificationEngine` runs every check, `TargetedVerifier` runs a
 * *candidate set* of tests derived from the dependency graph, without changing
 * the verdict semantics (§2.3). The salient rule is the safety net: the graph is
 * authoritative only when it is **complete**. When the affected-set resolver
 * reports `complete: false` (a dynamic import, a bare package, an unparsed file),
 * or a change maps to an empty test set, the verifier falls back to the full
 * suite rather than risk a verdict that skipped a test it cannot prove
 * irrelevant.
 *
 * This engine never imports `@harness/code-index` (boundary rule R4): the
 * affected set arrives via the {@link AffectedTestsResolver} seam, which the app
 * layer binds to the `code-index` package's `affectedTests`. The engine owns the
 * *routing policy* (targeted vs full); the leaf owns the *graph*.
 */

import type { OverallVerdict } from './types.js';

/** The affected-test set the dependency graph produced (day-14 §2.2). */
export interface AffectedTests {
  readonly tests: readonly string[];
  /** `false` when the graph is incomplete — the caller must run the full suite. */
  readonly complete: boolean;
}

/** Resolves a changed-file set to its affected tests (seam, not a code-index import). */
export type AffectedTestsResolver = (changedFiles: readonly string[]) => AffectedTests;

/** The outcome of a targeted (or fallback) verification run. */
export interface TargetedRunResult {
  /** `true` when the affected set was run; `false` when we fell back to the full suite. */
  readonly targeted: boolean;
  /** The test files actually run (empty on a full-suite fallback). */
  readonly testsRun: readonly string[];
  /** The overall verdict of whatever was run (same PASSED/FAILED semantics). */
  readonly verdict: OverallVerdict;
}

/** The two run modes injected for testing (full suite vs a named test subset). */
export interface TargetedVerifierOptions {
  readonly resolveAffected: AffectedTestsResolver;
  /** Run the full test suite; returns its verdict. */
  readonly runAll: () => Promise<OverallVerdict>;
  /** Run a subset of tests; returns the verdict of that subset. */
  readonly runTests: (tests: readonly string[]) => Promise<OverallVerdict>;
}

/** Routes a change to either the affected tests or the full suite. */
export class TargetedVerifier {
  constructor(private readonly options: TargetedVerifierOptions) {}

  async verify(changedFiles: readonly string[]): Promise<TargetedRunResult> {
    // Nothing changed — nothing to shorten; fall back to a plain full run.
    if (changedFiles.length === 0) {
      return { targeted: false, testsRun: [], verdict: await this.options.runAll() };
    }
    const { tests, complete } = this.options.resolveAffected(changedFiles);
    // A gap, or a change no test exercises, means the graph cannot prove the
    // remaining tests irrelevant — the full suite is the only honest run (§2.3).
    if (!complete || tests.length === 0) {
      return { targeted: false, testsRun: [], verdict: await this.options.runAll() };
    }
    return { targeted: true, testsRun: tests, verdict: await this.options.runTests(tests) };
  }
}
