/**
 * The object-store seam (day-21 §2.1) — the one interface the rest of the system
 * talks to when it offloads (or reads back) large, content-addressed bytes.
 *
 * A `ContentStore` addresses every object by its SHA-256 (`ContentRef.hash`),
 * never by a caller-chosen key: two callers who store the same bytes by
 * definition share one object, so deduplication is a property of the address,
 * not an extra bookkeeping step. The `backend` tag records *where* the bytes
 * landed (`db` inline vs `object` store) so a later reader can route the `get`
 * back to the right backend without knowing the store topology.
 *
 * Reads are integrity-checked: `get` streams the bytes through a SHA-256 verify
 * and rejects with {@link ContentIntegrityError} when the digest drifts from
 * the ref — a tampered or truncated object can never be served as truth.
 */

import type { Readable } from 'node:stream';

/** Where a content-addressed object physically lives. */
export type ContentBackend = 'db' | 'object';

/** A content-addressed handle returned by {@link ContentStore.put}. */
export interface ContentRef {
  readonly hash: string;
  readonly backend: ContentBackend;
}

/** The metadata a caller must supply alongside the bytes it stores. */
export interface PutMeta {
  readonly contentHash: string;
  readonly sizeBytes: number;
}

/** Raised when the bytes read back do not hash to the expected `ContentRef.hash`. */
export class ContentIntegrityError extends Error {
  constructor(
    public readonly expectedHash: string,
    public readonly actualHash: string,
  ) {
    super(`content integrity mismatch: expected ${expectedHash}, read ${actualHash}`);
    this.name = 'ContentIntegrityError';
  }
}

/**
 * A content-addressed byte store. `get` returns a streaming, hash-verified
 * {@link Readable}; the caller owns draining it.
 */
export interface ContentStore {
  put(content: Buffer, meta: PutMeta): Promise<ContentRef>;
  get(ref: ContentRef): Promise<Readable>;
  /** Remove an unreferenced object. GC-only: never delete a live snapshot. */
  delete(ref: ContentRef): Promise<void>;
  exists(ref: ContentRef): Promise<boolean>;
}
