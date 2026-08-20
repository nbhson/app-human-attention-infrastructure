# Day 14 — Targeted/Incremental Verification: Run Only Affected Tests via Graph

| | |
|---|---|
| **Week** | 3 — Dependency graph → targeted verify |
| **Spec refs** | Spec 7 §5.2 (targeted verification), §5.3 (incremental + result cache), §5.5 (execution environment) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 13 (impact analysis: change → affected tests) |

---

## 1. Objectives

By end of day you will have:

1. A **targeted verification strategy** in the Verification Engine that runs only the affected tests selected by Day 13's impact analyzer — replacing "always full suite" for routine changes.
2. An **incremental result cache** so unchanged files' test results are reused (Spec 7 §5.3), with content-hash invalidation.
3. A **verification strategy resolver** that picks Full vs Targeted vs Incremental per change, with a policy-based guard.
4. Correctness instrumentation: every targeted run records *what it did not run*, so Day 15 can prove "still correct" against the full-suite baseline.

This is the p95-latency driver of the whole phase (Phase-1 backlog: "Full-suite verification is the p95 driver").

---

## 2. Design Decisions

### 2.1 Strategy selection (explicit, not inferred)

```typescript
// packages/verification-engine/src/strategy.ts
export type VerifyStrategy = 'FULL' | 'TARGETED' | 'INCREMENTAL';

export function selectStrategy(impact: ImpactAnalysis, policy: VerificationPolicy): VerifyStrategy {
  if (policy.force_full || impact.confidence === 'LOW') return 'FULL';
  if (impact.affectedTests.length / totalTests > policy.targeted_max_ratio) return 'FULL'; // too broad to be worth it
  if (hasCachedResultsFor(impact.affectedTests)) return 'INCREMENTAL';
  return 'TARGETED';
}
```

- `VerificationPolicy` gains `force_full: boolean` and `targeted_max_ratio: float` (default 0.6: if targeting would run >60% of the suite, run full — targeting loses its benefit).
- A change that is `LOW` confidence already widens to full (Day 13); the resolver keeps that invariant.

### 2.2 Test run = selected tests + cache miss set

```typescript
// packages/verification-engine/src/targeted.ts
export class TargetedVerification {
  constructor(
    private readonly executor: TestExecutor,   // Phase 1/2 executor
    private readonly cache: ResultCache,       // incremental cache (below)
    private readonly analyzer: ImpactAnalyzer,
  ) {}

  async verify(changeId: string, filesChanged: FileChange[]): Promise<VerificationResult> {
    const impact = await this.analyzer.analyze(filesChanged);
    const strategy = selectStrategy(impact, this.policy);

    if (strategy === 'FULL') return this.executor.runAll();
    const toRun = strategy === 'INCREMENTAL'
      ? impact.affectedTests.filter(t => !this.cache.hit(t))
      : impact.affectedTests;
    const result = await this.executor.runTestSubset(toRun);
    // attach provenance: which tests ran, which were skipped, which were cache-reused
    result.metadata.selectedBy = 'targeted';
    result.metadata.skippedTests = irunTests - ranTests;  // full-suite-known tests NOT run
    return result;
  }
}
```

### 2.3 Incremental result cache (content-hash keyed)

Spec 7 §5.3 caches prior results and re-runs only changed files. Key the cache by `test_file + content_hash + source_hashes_of_dependencies + verification_tool_version`:

```typescript
interface CacheKey {
  testFile: string;
  testHash: string;             // test file content hash
  depHashes: string[];          // hashes of the source files this test (transitively) exercises
  toolVersion: string;          // vitest/jest version + config hash
}
```

- **Hit:** reuse the stored result (with a `cached: true` marker in the result — never presented as a fresh run).
- **Invalidation:** any dep hash change busts the key (same `content_hash` truth as Spec 4 §8; a stale cache is a miss, never a poison).

### 2.4 Provenance: record what was NOT run

The correctness contract for Day 15 is "targeted still correct." So every targeted result carries, in `metadata`:

```json
{
  "selectedBy": "targeted",
  "ranTests": ["..."],
  "cacheReusedTests": ["..."],
  "skippedTests": ["..."],       // tests known to the suite but NOT run this time
  "impactConfidence": "HIGH",
  "graphBuiltAt": "ISO8601"
}
```

`skippedTests` is the critical audit field. Without it, "PASSED" from a targeted run is indistinguishable from a full run's "PASSED" — exactly the confidence-without-evidence failure the system exists to prevent.

### 2.5 Execution environment (unchanged, but made explicit)

Targeted runs execute through the **same sandbox** as full runs (Spec 7 §5.5 container/worktree, Phase 2 built it). The subset selection happens *before* the sandbox run; it never changes how a test is *executed* — only how many.

---

## 3. Tasks

### 3.1 `VerificationPolicy` extension (45 min)

- [ ] Add `force_full`, `targeted_max_ratio` to the policy type + schema (nullable/backfill defaults).
- [ ] Migrate; default `targeted_max_ratio = 0.6`.

### 3.2 `TargetedVerification` + strategy resolver (150 min)

- [ ] `selectStrategy()` (§2.1) and `TargetedVerification.verify()` (§2.2).
- [ ] Hook into the existing `IVerificationEngine.verify(changeId)` path: analyze before scheduling checks.

### 3.3 `ResultCache` (120 min)

- [ ] `packages/verification-engine/src/cache/result-cache.ts` — key construction + get/set (§2.3).
- [ ] Store cached results in Postgres (or reuse Phase 2's verification cache table if one exists) keyed by the cache key hash.

### 3.4 Provenance metadata + event (60 min)

- [ ] Attach `ranTests`/`cacheReusedTests`/`skippedTests`/`graphBuiltAt` to results (§2.4).
- [ ] Emit `verification.targeted_completed { changeId, strategy, ranCount, skippedCount, cacheHitCount }`.

### 3.5 Tests (120 min)

- [ ] `selectStrategy`: LOW confidence → FULL; ratio > 0.6 → FULL; else TARGETED / INCREMENTAL when cache hits.
- [ ] Targeted run executes only `affectedTests`; `skippedTests` populated correctly.
- [ ] Cache hit reuses result with `cached: true`; a changed dep hash busts the key (miss).
- [ ] Full run emits `selectedBy = 'full'` (no skipped set).
- [ ] `verify()` on an invalid/empty change still falls back safely.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/verification-engine/src/strategy.ts` | Strategy resolver |
| `packages/verification-engine/src/targeted.ts` | `TargetedVerification` |
| `packages/verification-engine/src/cache/result-cache.ts` | Incremental result cache |
| `packages/db/src/schema/*.ts` + migration | `force_full`, `targeted_max_ratio`; cache table |
| `packages/verification-engine/src/__tests__/targeted.test.ts` | Targeted/incremental/cache tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/verification-engine test` — all tests pass.
- [ ] A HIGH-confidence change runs only `affectedTests`; the result records `skippedTests`.
- [ ] LOW-confidence change runs the full suite (never a narrowed set).
- [ ] Targeted ratio > `targeted_max_ratio` falls back to FULL.
- [ ] Cache reuses unchanged results flagged `cached: true`; a dep-hash change busts the key.
- [ ] `verification.targeted_completed` event carries run/skip/cache counts.
- [ ] Strategy provenance (`selectedBy`, `graphBuiltAt`) is attached to every result.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **`skippedTests` is not optional.** A targeted "PASSED" without the list of what it skipped is a false-confidence bug. This field is the difference between "verified" and "verified *the parts we happened to run*."
- **Cache key must include tool version.** A vitest upgrade that changes test semantics gives different results for the same source; keying on source hash alone would reuse stale (uploaded) results. Include version + config hash.
- **Targeted ≠ lower rigor, it's lower scope.** The sandbox, timeouts, flaky retry, and evidence-linking all stay identical (Spec 7 §5.5–5.6). Do not skip the evidence row or the flaky retry just because the set is smaller.
- **Ratio guard exists for a reason.** Targeting 95% of tests is not an optimization; it's full-suite with extra overhead. The `targeted_max_ratio` is the honest line.
- **Cache reuse is an optimization, not evidence of *this* run.** Present `cached: true` results separately in the report; do not let a cached PASSED look like a fresh independent run (the reviewer deserves to know).
- **Tomorrow (Day 15):** Week 3 checkpoint — targeted verification faster AND still correct vs the full-suite baseline.

---

*Prev: [Day 13 — Impact Analysis: Map a Change to Affected Tests (Transitive)](day-13.md) | Next: [Day 15 — Week 3 Checkpoint: Targeted Verification Faster + Still Correct](day-15.md)*
