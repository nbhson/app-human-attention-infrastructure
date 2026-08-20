# Day 26 — Hardening: Failure Injection on Vector, Object Store & Sandbox, plus Concurrency

| | |
|---|---|
| **Week** | 6 — Harden + exit review |
| **Spec refs** | Spec 10 (observability/SLOs/degradation), Spec 7 §5.7 (timeouts), Spec 5 §7 (retention), Spec 4 §5.2.3 (cache freshness), Spec 1 §24.4 (production readiness) |
| **Estimated effort** | 8 hours |
| **Prerequisites** | Days 21–25 (object store, sandbox ×2, Spec 8, Week-5 checkpoint) |

---

## 1. Objectives

By end of day you will have:

1. **Failure injection** for the three new failure surfaces — the vector index (Day 16/17), the object store (Day 21), and the sandbox (Days 22–23) — with each failure having a *defined degraded behavior*, not a crash.
2. **Concurrency hardening** — parallel tasks hitting the same object-store hash, cache key, and sandbox concurrently produce correct results (idempotent `put`, no cache stampede, no leaked containers).
3. **Graceful degradation contracts** written as tests: when each subsystem fails, the system still produces a *correct or clearly-degraded* result (semantic → keyword fallback; object store → DB path; sandbox → in-process), and every degradation is observable (Spec 10).
4. A **production-readiness gate list** (Spec 1 §24.4) that Phase 3 turns into rollout criteria — but the *tests* for each gate exist and run today.

Day 26 is the difference between "Phase 2 built subsystems" and "Phase 2 built subsystems that survive." Hardening is measured in failure modes, not features.

---

## 2. Design Decisions

### 2.1 One degradation contract per subsystem

| Subsystem | Failure injected | Degraded behavior | Observable signal (Spec 10) |
|-----------|------------------|-------------------|------------------------------|
| Vector index | `pgvector` error / no embedding | Semantic rank → `keyword` (no semantic record) | `context_semantic_fallback_total` counter |
| Object store | S3/MinIO down / integrity fail | Route to DB path (`db` backend) for small; block > threshold with explicit error | `object_store_fallback_total` + `object_store_error_total` |
| Sandbox | Daemon down / image missing | Verify → in-process (Day 22 fallback); code mode → `SandboxInfraError` surfaced | `sandbox_fallback_total` (already Day 22) |

Each is *loud* (counter + log + alert when rate > threshold) and *bounded* (a fallback that itself fails must fail closed, not loop).

### 2.2 Failure injection is real, not mocked-through-everything

Inject at the *seam* with a fake backend (a failing `Embedder`, a failing `ObjectStoreContentStore`, a failing `Sandbox`), not by mocking the whole engine — so the engine's own degradation logic is what's under test.

```typescript
// packages/context-engine/src/__tests__/failure-injection.test.ts
const failingEmbedder = { embed: () => { throw new EmbeddingUnavailableError(); } };
// resolveContext with failing embedder + semantic flag ON → keyword served, counter bumped, no throw
```

### 2.3 Concurrency invariants

- **Object store idempotency**: N parallel `put`s of the same `content_hash` → one object, no error (S3 natural idempotence asserted under race).
- **Cache stampede**: N parallel misses on the same `(source_id, content_hash)` → one read+parse, one `set` (advisory lock or single-flight), no duplicate work.
- **Sandbox lifecycle**: a task's containers are always harvested even on error/timeout (no orphans; `docker ps` empty post-run) — extend Day-22's kill-on-expiry to cover all exits.

### 2.4 A single-flight cache guard

The cache (Day 20) had no concurrency story. Add single-flight to `set` on miss:

```typescript
// packages/context-engine/src/cache/context-cache.ts (gains)
private inFlight = new Map<string, Promise<CachedSource>>();
get(sourceId, contentHash) {
  const key = `${sourceId}:${contentHash}`;
  return this.inFlight.get(key) ?? this.computeAndSet(key);
}
```

This prevents a burst of misses from fanning out duplicate reads/parses (and duplicate `embed` calls downstream).

---

## 3. Tasks

### 3.1 Vector-index failure injection (90 min)

- [ ] `EmbeddingUnavailableError`; `resolveContext`/`resolveWithShadow` catches the embedder failure → serves `keyword`, bumps `context_semantic_fallback_total`, logs.
- [ ] Test: flag ON + failing embedder → `rank_method === 'keyword'`, no throw, counter incremented.

### 3.2 Object-store failure injection (90 min)

- [ ] `ObjectStoreUnavailableError`; `RoutingContentStore` falls back to `db` for small content; > threshold → explicit error (never partial object).
- [ ] Test: object backend down + small put → `backend='db'`; large put → error; counter bumped.

### 3.3 Sandbox failure + orphan harvest (90 min)

- [ ] Assert sandbox fallback path is redirect-reentrant (no double-fallback loop); add `orphan` harvest on every exit path (success/error/timeout).
- [ ] Test: failing `Sandbox` → in-process verification; a killed/timeout container leaves no `docker ps` row.

### 3.4 Concurrency tests (120 min)

- [ ] Parallel `put` same hash → single object (assert object count == 1).
- [ ] Parallel cache miss → one read (single-flight); parallel `set` non-duplicating.
- [ ] Parallel sandbox runs → each result attributed to its own `content_hash`; no cross-contamination.

### 3.5 Alerting (30 min)

- [ ] Prometheus rules: fallback-rate thresholds on `*_fallback_total` rate > X → page (Spec 10 alert governance).

### 3.6 Production-readiness gate list (60 min)

- [ ] `docs/plan/phase-2/hardening-gates.md` — each §2.1 contract + its test, as the Phase-3 rollout checklist (Spec 1 §24.4).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/context-engine/src/cache/context-cache.ts` (updated) | Single-flight guard |
| `packages/context-engine/src/__tests__/failure-injection.test.ts` | Vector fallback |
| `packages/object-store/src/__tests__/failure-injection.test.ts` | Object-store fallback |
| `packages/sandbox/src/__tests__/harvest.test.ts` | Orphan harvest |
| `packages/*/__tests__/concurrency.test.ts` | Race tests |
| `docs/plan/phase-2/hardening-gates.md` | Production-readiness gate list |
| `deploy/prometheus/alerts.yml` | Fallback-rate alerts |

---

## 5. Acceptance Criteria

- [ ] Failing embedder with shadow ON → served `rank_method === 'keyword'`, no throw, `context_semantic_fallback_total` incremented.
- [ ] Object backend down → small content routes to `db`, large content errors explicitly, `object_store_fallback_total`/`error_total` bumped.
- [ ] Sandbox down → in-process verification; a killed/timeout container leaves no orphan (`docker ps` empty).
- [ ] Parallel `put` same hash → exactly one stored object; parallel cache miss → one read (single-flight); parallel sandbox runs → each attributed to its own hash.
- [ ] Fallback-rate Prometheus rules fire on rate > threshold (rule present + test alert imported).
- [ ] `hardening-gates.md` lists each degradation contract with its test.
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green.
- [ ] No engine imports another engine (architecture test green).

---

## 6. Notes & Pitfalls

- **A fallback that isn't loud is just a failure wearing a nice hat.** Every degradation must bump a counter and (over threshold) page. Silent fallback is how a subsystem that's "down" becomes a subsystem that's *silently misbehaving* for weeks — the exact thing Spec 10 exists to prevent.
- **Fail closed, but know the difference.** "Sandbox down → in-process" is fail-open (degraded but proceeds); "large artifact + object store down → error" is fail-closed. Both are right *in their place*; what's never right is a fallback that loops back into the failing path (redirect-reentrant bug).
- **Concurrency bugs live at the seam.** Two tasks writing the same hash, or two misses on the same cache key, are where object-store dedup and cache single-flight are tested — under race, not in series. Without single-flight, a burst of identical tasks is a self-inflicted stampede.
- **Orphaned containers are a resource leak with a security flavor.** A half-harvested sandbox is a dangling write surface. The harvest test (`docker ps` empty) must run on *all* exit paths — the timeout path is the one everyone forgets.
- **Latency vs isolation is a real trade to record, not resolve blindly.** If the hardening retro shows in-process fallback is used far more than expected, that's a signal the sandbox is too slow to rely on — a Phase-3 decision, not a Day-26 code tweak.
- **Next (Day 27):** E2E under Phase-2 infra — the full pipeline (auth + sandbox + metrics) passes an end-to-end run, proving the hardened system is one system, not five subsystems.

---

*Prev: [Day 25 — Week 5 Checkpoint](day-25.md) | Next: [Day 27 — E2E Under Phase-2 Infra](day-27.md)*