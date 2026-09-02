# Phase 3 · Week 3 Retro — Verification breadth checkpoint

_Day-15 checkpoint (Phase 3, Week 3). Week 3 took the clone machinery Weeks 1–2
led up to and answered the one question that decides whether "run the PR's own
tests" is worth having: **can it be faster without being wrong?** The week
delivered the dependency-graph leaf (`@harness/code-index`, day-14), the targeted
routing policy (`TargetedVerifier`, day-14), and the FAILED→flag→non-blocking
invariant (day-13), and the checkpoint wires all of them together into one
end-to-end demo. It ends with one provable statement — **targeted verdict == full
verdict on every case, with fewer tests where provable, and a FAILED build/test
flags evidence without auto-rejecting.** Same rule as every prior retro: honest
by design, numbers-first, blameless, and green before committed._

---

## What held

- **"Still correct" is a verdict-parity table, not a claim.** `pnpm
demo:verification` prints each equivalence case side by side — changed file,
  tests run (`targeted/full`), measured latency, verdict, and a parity mark — and
  asserts `targeted verdict === full verdict` on all four cases. Three are green
  and one is a **red** case (`calc.ts` with a failing test), so parity is proven
  on failures too, which is where a skipped test would actually bite.
- **The speedup is earned, not asserted.** The affected set comes from the real
  `code-index` graph (reverse-BFS transitive closure), and it is a strict subset —
  `add.ts` → 2/3 tests, `calc.ts` → 1/3 — so "fewer tests" is a property of the
  graph, not a hand-picked number.
- **The safety net is the feature.** Four unprovable shapes all fall back to the
  full suite: a dynamic `require('./' + name)` gap (`complete:false`), a changed
  file never indexed, a leaf no test imports, and an empty change set. The graph
  refuses to guess; the verdict it cannot prove is the full suite's.
- **FAILED is information, never authority.** The day-13 `flagReport` +
  `renderFlag` pair turns a failing clone into a markdown block with the failing
  test, the raw exit code, an evidence ref, and a truncated tail — and carries no
  decision field. The item reaches `AWAITING_REVIEW`; write-back is gated on a
  human review, not on a green verify.
- **A failed clone is loud, and teardown still runs.** `cloneAndCheckout` throws a
  typed `CloneError` naming the exact failing git step (the day-11 §6 head-SHA
  pitfall), and the caller's `finally` removes the workdir even on failure — a
  clone can never silently hand back an empty worktree.

## The W3 evidence (recorded demo output)

`pnpm demo:verification` (real graph + real routing + real flag code; the
sandbox/clone legs are unit-covered by `clone-verifier` + `sandboxed-check`):

```
=== 1 — clone error surfacing + teardown-on-failure (day-11 §6, day-15 §3.3) ===
  surfaced: CloneError (step "fetch"):
            git fetch failed (exit 128): fatal: couldn't find remote ref <head-sha>
  teardown: workdir removed in the `finally` even though the clone threw ✓

=== 2 — index the fixture → full vs targeted equivalence table ===
  graph: 8 files, 3 tests, incomplete files: 1 (dynamic import)

  leaf add.ts (green)   src/add.ts    tests 2/3  latency 31 vs 46 ms  verdict PASSED  ✅
  leaf mul.ts (green)   src/mul.ts    tests 2/3  latency 31 vs 46 ms  verdict PASSED  ✅
  mid  calc.ts (green)  src/calc.ts   tests 1/3  latency 16 vs 46 ms  verdict PASSED  ✅
  mid  calc.ts (red)    src/calc.ts   tests 1/3  latency 16 vs 46 ms  verdict FAILED  ✅

  equivalence holds: targeted verdict == full verdict on every case (green AND red).

=== 3 — fallback safety net — an unprovable change runs the full suite ===
  dynamic import gap   → full suite (graph incomplete (complete:false)) ✓
  file never indexed   → full suite (changed file absent from the index) ✓
  no affected test     → full suite (empty affected set) ✓
  empty change set     → full suite (nothing to shorten) ✓

=== 4 — FAILED fixture → report flag with evidence (never auto-rejects) ===
  ## Verification — FAILED
  **Review required before any write-back.**
  - failed (code): TEST
  ### ❌ TEST — FAILED
  - exit code: `1`
  - evidence: `evidence:sha256:6f1a2b3c…`
  # …[truncated tail naming the failing test: src/calc.test.ts]…

  → non-blocking: FAILED annotates the review; the item reaches AWAITING_REVIEW ✓
```

Acceptance criteria, one line each: `pnpm demo:verification` runs end-to-end over a
recorded fixture; targeted verdicts match full verdicts on every equivalence case
(green and red) with strictly fewer tests; the failing fixture flags the report
with evidence (exit code + ref + tail) and the item reaches `AWAITING_REVIEW`
(never auto-rejected); clone error surfaces as a typed `CloneError` and teardown
runs on failure.

## What drifted (and how it was caught)

- **tree-sitter never materialized, and the indexer stayed hand-rolled.** A
  repo-wide probe for any `tree-sitter`/`web-tree-sitter` reference came back empty
  (zero in `pnpm-lock`), so day-14's `code-index` is a deterministic lexical TS/JS
  scanner rather than an AST grammar. The correctness story does not change: the
  guarantee is the `complete:false` fallback (over-approximate edges, never guess a
  skip), not the parse quality. Documented honestly in the package header.
- **The app host is the only legal place to bind graph + engine.**
  `verification-engine` may not import `code-index` (boundary R4), so
  `TargetedVerifier` takes the affected set through the `AffectedTestsResolver`
  seam and the binding lives in the demo/`apps/api` layer. This forced the demo to
  depend on `@harness/code-index` (added to `apps/api` deps + `pnpm install`) —
  surfaced as a missing-module on first `tsc` of the script, not a boundary
  violation.
- **The W3 wiring-map gap was the same shape as W2's.** `cloneAndCheckout`,
  `CloneVerifier`, `code-index`, `TargetedVerifier` are assembled at the host and
  register **no DI token**, so they needed a dedicated "seams, not DI tokens" note
  rather than table rows — added alongside the day-15 wiring-map pass.

## Boundary check

- **The graph leaf stayed a leaf.** `code-index` depends on no `@harness/*` package
  (node built-ins only, like `object-store`/`sandbox`), and `verification-engine`
  reaches it only through the resolver seam — the engine never imports a sibling
  leaf or the `git-provider` seam. `CloneResult` maps to `CloneWorktree`
  structurally, so the engine never names a Git host either. The architecture test
  - `eslint-plugin-boundaries` stayed green.

---

_Checkpoint rule applied: `pnpm typecheck` (**46/46**), `pnpm lint`, and `pnpm
test` (**787** tests / 139 files) are all green before this note is committed. The
demo runs end-to-end with no live key, no network, and no Docker — the sandbox
clone/test legs are exercised by their own unit/parity suites._

_Next: Day 16 — Review-memory Model: Reviews/Findings/Decisions Tiers.
Week 4 pivots to review memory; the clone/verify machinery is now stable — do not
refactor it mid-phase._
