# Day 23 — Review-Report Storage + Large-Diff Handling via `ContentStore`

| | |
|---|---|
| **Week** | 5 — Sandbox, object store, Spec 8 |
| **Spec refs** | Spec 5 §4.2 (`ContentStore`), Spec 7 §5.4 (review report / evidence storage), Spec 9 §3.2 (tamper-evident evidence) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 21 (object store `ContentStore` + size routing + integrity); Day 07 (report generator); Day 22 (verification sandbox) |

---

## 1. Objectives

By end of day you will have:

1. A **`ReviewReportStore`** — the reviewer's full output (report + findings + fix suggestions + decision context) becomes a **content-addressed, immutable record** persisted through the `ContentStore` seam, instead of inline columns that can be edited after the fact or bloat a Postgres row.
2. **Large-diff handling** — diffs over a threshold are streamed to the object store (Day 21) and referenced by `content_hash` in the review record, so a 100 MB PR diff never flows through the API payload or Postgres toast.
3. A **hash-verified read path** — fetching any report or diff recomputes and verifies its hash, so the record is tamper-evident (Spec 9 §3.2) and corruption is *detected*, not served.
4. **Dedup + provenance split** — identical diffs/reports store once (keyed by `content_hash`); the provenance metadata stays in Postgres, only the *bytes* relocate.

The reviewer stays read-only, but its *artifact* (the report a human acts on) needs the same storage discipline as any other evidence: pinned, addressable, un-editable after writing.

---

## 2. Design Decisions

### 2.1 `ReviewReportStore` is a thin seam over `ContentStore`

```typescript
// packages/review/src/storage/review-report-store.ts
export interface ReviewReportStore {
  put(report: ReviewerReport): Promise<ReportRef>;   // content-address, stores bytes via ContentStore
  get(ref: ReportRef): Promise<ReviewerReport>;      // streams + verifies hash on read
  exists(ref: ReportRef): Promise<boolean>;
}

export interface ReportRef { hash: string; backend: 'db' | 'object'; sizeBytes: number; }
```

The store resolves `TOKENS.ContentStore` from DI (Day 21's `RoutingContentStore`). Reports are serialized once, hashed once, and read back byte-identical — no second serialization path to drift.

### 2.2 Large-diff routing reuses Day 21's size policy

A diff's raw bytes are content-addressed exactly like artifacts: `> OBJECT_STORE_THRESHOLD_BYTES` → `backend: 'object'`, else `db`. The review record stores the diff's `content_hash` + backend, never the inline bytes. This is the *same* `RoutingContentStore`, not a review-specific fork.

### 2.3 The review record keeps provenance in Postgres, bytes in the store

```sql
-- packages/db/migrations/0114_review_report_store.sql
ALTER TABLE review_reports
  ADD COLUMN content_hash text NOT NULL,
  ADD COLUMN backend text NOT NULL DEFAULT 'db',
  ADD COLUMN size_bytes bigint NOT NULL,
  ADD COLUMN diff_content_hash text,
  ADD COLUMN diff_backend text,
  ADD COLUMN diff_size_bytes bigint;
```

`review_reports` still carries the metadata a query needs (`review_id`, `actor`, timestamps, which `context_snapshot`/`verification_reports` the reviewer saw). The report body and the large diff live behind their `content_hash` refs.

### 2.4 Immutability + integrity

- **Append-only:** a report is written once; "changes" are new `review_reports` rows (superseded via `review_id` ordering), never an UPDATE to an existing body.
- **Hash-verified reads:** `get` streams the bytes through SHA-256 and fails `ContentIntegrityError` on mismatch (reuse Day 21's check) — a tampered report can't be silently re-served.
- **Retention:** reports + diffs follow Spec 5 §7 (retain for the retention window; GC only of *unreferenced* hashes).

---

## 3. Tasks

### 3.1 Migration + store scaffold (60 min)

- [ ] Migration `0114_review_report_store.sql` (§2.3).
- [ ] `packages/review/src/storage/review-report-store.ts` (§2.1) — `put`/`get`/`exists` over `ContentStore`.

### 3.2 Large-diff routing + streaming (90 min)

- [ ] `packages/review/src/storage/diff-store.ts` — content-address the raw diff (stream, don't buffer), route by size, record `diff_content_hash`/`diff_backend`.
- [ ] Wire the diff-fetch path (Spec 2's change content) to resolve the ref instead of loading inline bytes.

### 3.3 Reviewer-output pipeline (90 min)

- [ ] After the reviewer produces a validated report, `ReviewReportStore.put` writes it; the `review_reports` row stores the `content_hash` ref.
- [ ] The Day-07 report generator reads via the store (hash-verified), not from inline JSON columns.

### 3.4 Integrity + dedup (60 min)

- [ ] `get` re-verifies hash; `ContentIntegrityError` on mismatch.
- [ ] Two identical diffs → one object key (dedup), asserted.

### 3.5 Tests (120 min)

- [ ] Round-trip: `put` a report → `get` → byte-identical + hash verified.
- [ ] Size routing: a > threshold diff → `object`; a small one → `db`.
- [ ] Tamper: corrupt the stored bytes → `get` throws `ContentIntegrityError`.
- [ ] Dedup: two same-content reports → one stored object.
- [ ] Streaming: a 50 MB diff does not buffer fully in memory.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0114_review_report_store.sql` | Report/diff ref columns |
| `packages/review/src/storage/review-report-store.ts` | `ReviewReportStore` over `ContentStore` |
| `packages/review/src/storage/diff-store.ts` | Large-diff routing + stream |
| `packages/review/src/__tests__/review-report-store.test.ts` | Round-trip/tamper/dedup/streaming |

---

## 5. Acceptance Criteria

- [ ] `put`/`get` round-trips a review report byte-identical, hash verified on read.
- [ ] A > threshold diff resolves to `backend='object'`; a small one to `db`.
- [ ] A tampered report fails `get` with `ContentIntegrityError`.
- [ ] Two same-content reports produce a single stored object (dedup).
- [ ] A 50 MB diff streams in/out without full buffering (asserted).
- [ ] `review_reports` stores `content_hash`/`backend`/`size_bytes` (no inline report body or diff bytes past the threshold).
- [ ] `grep -rn "new ObjectStoreContentStore" packages/review/src` returns zero (store resolves the seam via DI).
- [ ] `pnpm --filter @harness/review test` + `…object-store test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Reviewer reports are evidence, so they must be append-only.** A `review_reports` body that can be edited after a human has acted on it is provenance theater. Write once, supersede by ordering, never UPDATE.
- **Don't re-implement the object store in `@harness/review`.** The diff and report bytes go through the Day-21 `ContentStore` (and its `RoutingContentStore`). A review-local S3 client bypasses the seam and breaks the boundary rules.
- **Provenance stays in Postgres, bytes relocate.** The `review_id`, `actor`, decision, and which evidence the reviewer saw are queryable metadata; only the payloads move to the object store.
- **Stream don't buffer.** "Large diff" that gets `await response.json()`'d into one Node string is how a 100 MB PR takes down the API. The streaming test is the guard.
- **Hash verification on read is what makes "stored" and "trusted" different.** Object storage can silently truncate; `ContentIntegrityError` is the difference between a corrupted report and a merge-relevant decision made on corrupted evidence.
- **Next (Day 24):** promote Spec 8 (Human Review Interface) to a standalone spec — the surface that displays the pinned report, the evidence, and the decision.

---

*Prev: [Day 22 — Container Sandbox for Verification (Spec 7 §5.5)](day-22.md) | Next: [Day 24 — Promote Spec 8: Human Review Interface](day-24.md)*