# Day 21 — Object Store: S3/MinIO `ContentStore` for Large Artifacts

| | |
|---|---|
| **Week** | 5 — Sandbox, object store, Spec 8 |
| **Spec refs** | Spec 5 §4.2 (ContentStore / ObjectStoreBackend), §2.1 (`content_hash`, size), §7 (retention/archival) |
| **Estimated effort** | 7 hours |
| **Prerequisites** | Day 20 (Week-4 checkpoint); Phase-1 artifact-tracker stores content content-addressed (DatabaseBackend default) |

---

## 1. Objectives

By end of day you will have:

1. A new **`packages/object-store`** implementing the `ContentStore` seam with an **S3/MinIO backend** — `put`/`get` keyed by `content_hash` (content-addressed), so identical content is stored once regardless of how many artifacts reference it.
2. A **size-based routing policy**: large artifacts (> threshold) go to the object store; small ones stay in Postgres — without the tracker knowing *where* content lives (it only ever sees `ContentStore`).
3. **Streaming** for large reads/writes (no buffering a 100 MB file into process memory), and **byte-integrity** — `get` recomputes and verifies the hash on read.
4. **Di wiring** so `@harness/artifact-tracker` resolves `ContentStore` from DI and its `Storage Manager` (Spec 5 §7) consults the backend transparently.

This is the `ObjectStoreBackend` that Spec 5 §4.2 declared back in Phase 1. It's the last of the "widening infrastructure behind a declared seam" changes — the tracker's interface does not change; its storage backend just got a second address space.

---

## 2. Design Decisions

### 2.1 `ContentStore` is the seam; backends are interchangeable

```typescript
// packages/object-store/src/content-store.ts   (interface — already a Phase-1 seam)
export interface ContentStore {
  put(content: Buffer | Readable, meta: { contentHash: string; sizeBytes: number }): Promise<ContentRef>;
  get(ref: ContentRef): Promise<Readable>;          // streams; verifies hash on read
  delete(ref: ContentRef): Promise<void>;           // unreferenced GC only
  exists(ref: ContentRef): Promise<boolean>;
}

export interface ContentRef { hash: string; backend: 'db' | 'object'; }
```

`ObjectStoreContentStore` implements it over S3 (`@aws-sdk/client-s3`), MinIO-compatible (same S3 API on a local endpoint). `DatabaseContentStore` is the Phase-1 implementation kept for small artifacts.

### 2.2 Routing by size — a policy, not the tracker's job

```typescript
// packages/object-store/src/routing-store.ts
export class RoutingContentStore implements ContentStore {
  constructor(db: ContentStore, object: ContentStore, thresholdBytes: number) {}
  async put(content, meta) {
    if (meta.sizeBytes > this.thresholdBytes) return this.object.put(content, meta);
    return this.db.put(content, meta);
  }
  async get(ref) { return ref.backend === 'object' ? this.object.get(ref) : this.db.get(ref); }
}
```

The threshold lives in config (`OBJECT_STORE_THRESHOLD_BYTES`, default e.g. 1 MB, mirroring Spec 5 §7's "warns on >1MB content"). The artifact tracker resolves `RoutingContentStore` — it neither knows nor cares which backend a ref hit.

### 2.3 Content-addressed object keys = free dedup

Object key is the `content_hash` (not a path, not an artifact id). Two artifacts with identical content produce the same key and `put` is an idempotent no-op the second time (S3 `PutObject` with the same key is naturally idempotent). `delete` is forbidden on the hot path — only GC of *unreferenced* hashes (Spec 5 §7's retention rules) may delete.

### 2.4 Integrity on read

`get` streams the object, feeding the bytes through a SHA-256 as they pass, and fails `ContentIntegrityError` if the computed hash ≠ the requested `ContentRef.hash`. This is the object-store analogue of Spec 9 §3.2's `immutableHash`: distribution never silently corrupts content.

---

## 3. Tasks

### 3.1 Scaffold + interface (45 min)

- [ ] `packages/object-store` (`@harness/object-store`); `src/content-store.ts` (§2.1).
- [ ] `docker-compose.yml` — add MinIO service (or reuse S3-compatible endpoint).

### 3.2 `ObjectStoreContentStore` (120 min)

- [ ] `src/object-store-content-store.ts` — `put`/`get`/`exists`/`delete` over S3 SDK, streaming, hash-verifying `get`.
- [ ] `.env.example` — `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY`, `OBJECT_STORE_BUCKET`, `OBJECT_STORE_THRESHOLD_BYTES`.

### 3.3 `RoutingContentStore` + DI (60 min)

- [ ] `src/routing-store.ts` (§2.2); register `TOKENS.ContentStore` in `bootstrap.ts`; artifact-tracker resolves it.
- [ ] Update `docs/architecture/wiring-map.md`.

### 3.4 Storage Manager integration (90 min)

- [ ] Point the tracker's `Storage Manager` (Spec 5 §7) at `ContentStore.get/put`; large artifacts → object ref; small → db ref.
- [ ] Keep the provenance metadata in Postgres (never moved) — only *content bytes* relocate.

### 3.5 Tests (105 min)

- [ ] Round-trip: `put` a large buffer → `get` → byte-identical + hash verified (MinIO testcontainer or mock).
- [ ] Routing: > threshold → `backend='object'`; < threshold → `backend='db'` (spy backends).
- [ ] Dedup: two `put`s, same content → one object key (exists true, no duplicate).
- [ ] Integrity: corrupt the stored object (simulate) → `get` throws `ContentIntegrityError`.
- [ ] Streaming: a 50 MB put/get doesn't buffer the whole payload (memory assertion or stream tap).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/object-store/src/content-store.ts` | `ContentStore` interface (re-homed seam) |
| `packages/object-store/src/{object-store-content-store,routing-store}.ts` | S3/MinIO + size routing |
| `docker-compose.yml` (updated) | MinIO service |
| `packages/object-store/src/__tests__/content-store.test.ts` | Round-trip/routing/dedup/integrity/streaming |

---

## 5. Acceptance Criteria

- [ ] `put`/`get` round-trips a large artifact byte-identical, with hash verified on read.
- [ ] Size routing: a 2 MB artifact resolves to `backend='object'`, a 50 KB artifact to `backend='db'`.
- [ ] Two identical 2 MB artifacts produce a single object key (`exists` true, no second stored object).
- [ ] A tampered object fails `get` with `ContentIntegrityError`.
- [ ] A 50 MB artifact streams in/out without a full-buffer allocation (asserted).
- [ ] The artifact tracker resolves `ContentStore` from DI; `grep -n "ObjectStoreContentStore" packages/artifact-tracker/src` returns zero (tracker sees only the seam).
- [ ] `pnpm --filter @harness/object-store test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Never key objects by path or artifact id.** Content-addressing (`content_hash` key) is what gives free dedup and makes `put` idempotent. Key by id and you've recreated the "same content stored N times" problem the seam exists to prevent.
- **`delete` is GC-only.** Nothing on the request path may delete an object. An object without a referencing row may be GC'd; anything still referenced is append-only by convention. One stray `delete` on the hot path deletes provenance.
- **Provenance stays in Postgres.** The object store relocates *bytes*, never the `changes`/`artifacts` metadata. If you move the metadata too, the tracker's query surface (Spec 5 §8) breaks and "who changed what why" stops being answerable.
- **MinIO and S3 are the same API but different auth models.** Keep the client path singular (S3-compatible); don't fork a MinIO-specific code path — that's two backends wearing one package name.
- **Hash verification on `get` is not optional.** Object storage can silently truncate or corrupt; the `ContentIntegrityError` path is how corruption becomes *detectable* rather than a poisoned artifact merged downstream.
- **Next (Day 22):** container sandbox for verification (Spec 7 §5.5) — the first of two isolation-boundary days.

---

*Prev: [Day 20 — Context Cache: `source_id + content_hash`, TTL & Freshness (+ Week 4 Checkpoint)](day-20.md) | Next: [Day 22 — Container Sandbox for Verification (Spec 7 §5.5)](day-22.md)*
