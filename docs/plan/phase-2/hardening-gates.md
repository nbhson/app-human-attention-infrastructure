# Day 26 — Hardening Gates

Production-readiness gate list (Spec 1 §24.4). Each row pairs a degradation
contract from Day 26 §2.1 with the failure-injection test that proves it, so the
Phase-3 rollout has a *run-today* checklist rather than a wish-list. A gate is
**green** only when its test runs in CI and passes.

> The rule for every contract: a fallback that isn't loud is a failure wearing
> a nice hat. Each degradation below bumps a counter **and** has an alert
> (`infra/prometheus/alerts.yml`) that pages on a sustained rate — never a silent
> degrade.

## Degradation contracts

| Subsystem | Failure injected | Degraded behavior | Signal (counter → alert) | Test |
|---|---|---|---|---|
| Vector index | Embedder throws / `!ok` | Semantic shadow → keyword (`rank_method = keyword`) | `harness_context_semantic_fallback_total` → `SemanticFallbackSustained` | `packages/context-engine/src/__tests__/failure-injection.test.ts` |
| Object store | S3/MinIO port down | Small content → `db` backend; over the inline ceiling → explicit error (fail-closed) | `harness_object_store_fallback_total` / `harness_object_store_error_total` → `ObjectStoreFallbackSustained` / `ObjectStoreErrorSustained` | `packages/object-store/src/__tests__/failure-injection.test.ts` |
| Object store (integrity) | Read-back SHA-256 drift | Stream rejects with `ContentIntegrityError` (never served) | `harness_object_store_integrity_error_total` → `ObjectStoreIntegrityDrift` | `packages/object-store/src/__tests__/content-store.test.ts` |
| Object store (consumer) | Snapshot store `put` unavailable | `SnapshotStore.save` fails closed, no partial row | `harness_object_store_error_total` | `packages/artifact-tracker/src/__tests__/snapshot-store.test.ts` |
| Sandbox | Daemon/image down | Verification → in-process (Day-22 fallback, redirect-reentrant guarded) | `harness_sandbox_fallback_total` → `SandboxFallbackSustained` | `packages/verification-engine/src/__tests__/sandboxed-check.test.ts` |
| Sandbox (lifecycle) | Command hangs / timeout | Container force-removed (`rm -f`) — no orphan | (lifecycle, no counter) | `packages/sandbox/src/__tests__/harvest.test.ts` |

## Concurrency invariants

| Invariant | Assertion | Test |
|---|---|---|
| Object-store idempotency | N parallel `put` same hash → exactly one object | `packages/object-store/src/__tests__/concurrency.test.ts` |
| Cache stampede | N concurrent `collect()` of one source → one read+set | `packages/context-engine/src/__tests__/concurrency.test.ts` |
| Cache write idempotency | N concurrent `set` same source → one row | `packages/context-engine/src/__tests__/concurrency.test.ts` |
| Sandbox attribution | N parallel runs → each result attributed to its own container/workdir | `packages/sandbox/src/__tests__/harvest.test.ts` |

## Alert wiring map

The object-store and sandbox packages are **leaves** (architecture rules R11/R12 —
zero `@harness/*` runtime imports), so they cannot call `@harness/observability`
recorders directly. The signals are wired at their **consumers**, which may import
observability:

| Signal | Bumped by | Location |
|---|---|---|
| `recordSemanticFallback` | `SemanticRetriever.retrieve` (context-engine is an engine) | `packages/context-engine/src/retrieval/semantic-retriever.ts` |
| `recordObjectStoreError` (fail-closed) | `SnapshotStore.save` (artifact-tracker) | `packages/artifact-tracker/src/snapshot-store.ts` |
| `recordObjectStoreFallback` / `onError` | `RoutingContentStore` callbacks → consumer (injected, no-op default) | `packages/object-store/src/routing-store.ts` |
| `recordSandboxFallback` | `SandboxedCheck` (verification-engine) | `packages/verification-engine/src/executors/sandboxed-check.ts` |

`prometheus.yml` imports `alerts.yml` via `rule_files`; both live in
`infra/prometheus/` (mounted read-only at `/etc/prometheus` in `docker-compose.yml`).

## Rollout gate status

- [ ] **G1** Vector-index fallback is loud + keyword-correct (test green).
- [ ] **G2** Object-store degrade is loud + bounded (small→db, large→error) (tests green).
- [ ] **G3** Sandbox fallback is redirect-reentrant-safe + no orphaned containers (tests green).
- [ ] **G4** Concurrency invariants hold under race (idempotent put, single-flight, no cross-attribution) (tests green).
- [ ] **G5** Every degradation counter has a paging alert, imported by the scrape config (`alerts.test.ts` green).
- [ ] **G6** No engine imports another engine (architecture test green).

---

*Prev: [Day 26 — Hardening](day-26.md) | Next: [Day 27 — E2E Under Phase-2 Infra](day-27.md)*