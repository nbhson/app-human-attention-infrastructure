# @harness/object-store — Content-Addressed Object Store

The `ContentStore` seam for large artifacts — keeps big content out of Postgres
and behind a small interface so the backing store (S3/MinIO or in-memory) can be
swapped without touching the engines.

**Status:** Phase 2 (Day 21) complete (as-built) ·
**Boundary rule:** shared package — imports only shared infrastructure.

---

## Purpose

1. **Define the `ContentStore` seam** — engines depend on the interface, not a backend.
2. **Store large artifacts content-addressed** — the same content hashes to the same key.
3. **Route by size/kind** — large content goes to the object store, small stays elsewhere.
4. **Stream** — avoid buffering large bodies in memory.

---

## Model

```text
   engine code ──▶ ContentStore (interface) ──▶ routing-store (size/kind)
                                                      │
                           ┌──────────────────────────┼──────────────────────────┐
                           ▼                          ▼                          ▼
                  object-store-content-store   in-memory-content-store      (small passthrough)
                        (S3 / MinIO)            (dev/test fallback)
                              │
                              ▼
                        aws-s3-port (thin SDK port, testable without S3)
```

---

## Implementations

| Implementation | When |
| --- | --- |
| `in-memory-content-store.ts` | Dev/test fallback — no external service. |
| `object-store-content-store.ts` | S3/MinIO-backed — the real one behind MinIO or AWS S3. |

The `aws-s3-port.ts` is a thin port over the AWS SDK so the store is testable
without S3; `streams.ts` keeps large bodies out of memory.

---

## Modules

| Module | What it provides |
| --- | --- |
| `content-store.ts` | The `ContentStore` interface / contract. |
| `in-memory-content-store.ts` | In-memory implementation. |
| `object-store-content-store.ts` | S3/MinIO-backed implementation. |
| `routing-store.ts` | Routes content by size/kind. |
| `aws-s3-port.ts` | Testable port over the AWS S3 SDK. |
| `streams.ts` | Streaming helpers. |

---

## Key invariants

- **Content-addressed writes.** Identical content dedupes for free (same key).
- **Seam, not a dependency.** Engines depend on `ContentStore`; the backend
  choice is a bootstrap concern — no engine imports a concrete backend.

---

## Directory structure

```
src/
├── index.ts
├── content-store.ts
├── in-memory-content-store.ts
├── object-store-content-store.ts
├── routing-store.ts
├── aws-s3-port.ts
└── streams.ts
```

## Public API surface

```typescript
// ContentStore, InMemoryContentStore, ObjectStoreContentStore,
// RoutingStore, AwsS3Port, streaming helpers
```

## Wiring

Resolved in `apps/api/src/bootstrap.ts` as `TOKENS.ContentStore`; the in-memory
backend is the configured fallback when no `S3_*`/`MINIO_*` env is present.