/**
 * `SnapshotStore` (day-14 §2.2, day-21 §3.4) — content-addressed, deduplicated
 * snapshot storage, and the tracker's "Storage Manager" seam.
 *
 * Agents routinely rewrite identical content (no-op edits, formatter passes), so
 * snapshots are keyed by SHA-256 and looked up before insert: capturing the same
 * bytes twice yields exactly one `snapshots` row. The hash doubles as a
 * tamper-evident content identity for verification and rollback.
 *
 * Day-21 splits the *bytes* from the *metadata*: content at or under
 * `thresholdBytes` is stored inline in `snapshots.content` (`content_backend =
 * 'db'`, the Phase-1 default), while larger content is offloaded to an injected
 * {@link ContentStore} (S3/MinIO) and referenced only by `content_hash`
 * (`content_backend = 'object'`). `content_hash` stays the dedup key either way,
 * and — because byte size is a pure function of the content itself — the same
 * hash always resolves to the same backend, so the dedup check is backend-blind.
 * Without a store, or under the threshold, behaviour is exactly the Phase-1
 * inline path.
 *
 * `save` takes the *executor* (the top-level `DrizzleDB` in unit tests, or the
 * open transaction handed to it by `ArtifactTracker.capture`) so the snapshot
 * insert lands in the same atomic unit as the change + artifact writes — a crash
 * can never leave an artifact pointing at a snapshot that was never committed.
 * The object `put` happens *before* the insert and is content-addressed and
 * idempotent, so a later rollback leaves at worst an unreferenced object for GC.
 */

import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { brand, newSnapshotID } from '@harness/domain';
import type { ChangeID, SnapshotID } from '@harness/domain';
import { snapshots } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { ObjectStoreUnavailableError } from '@harness/object-store';
import type { ContentStore } from '@harness/object-store';
import { recordObjectStoreError } from '@harness/observability';

/** The query operations `save` needs: satisfied by both `DrizzleDB` and its transaction. */
export type SnapshotExecutor = Pick<DrizzleDB, 'select' | 'insert'>;

/** Where a snapshot's bytes live (mirrors `snapshots.content_backend`). */
export type SnapshotContentBackend = 'db' | 'object';

/** SHA-256 of `content`, hex-encoded (dedup + integrity identity). */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Result of a snapshot save: the row's id and whether it was already present. */
export interface SnapshotResult {
  readonly snapshotId: SnapshotID;
  readonly deduped: boolean;
}

/** Default offload threshold: content larger than 1 MiB goes to the object store. */
export const DEFAULT_OBJECT_STORE_THRESHOLD_BYTES = 1024 * 1024;

export class SnapshotStore {
  constructor(
    private readonly contentStore?: ContentStore,
    private readonly thresholdBytes: number = DEFAULT_OBJECT_STORE_THRESHOLD_BYTES,
  ) {}

  /**
   * Save `content` for `changeId`, deduplicating by content hash. If any
   * snapshot already holds these bytes, return it without inserting a copy —
   * the content-addressed object store never sees a duplicate `put` either.
   */
  async save<T extends SnapshotExecutor>(executor: T, changeId: ChangeID, content: string): Promise<SnapshotResult> {
    const hash = sha256(content);

    const existing = await executor
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(eq(snapshots.content_hash, hash))
      .limit(1);
    const found = existing[0]?.id;
    if (found) {
      return { snapshotId: brand(found, 'SnapshotID'), deduped: true };
    }

    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const store = this.contentStore;
    let backend: SnapshotContentBackend = 'db';
    if (store !== undefined && sizeBytes > this.thresholdBytes) {
      backend = 'object';
      try {
        await store.put(Buffer.from(content, 'utf8'), {
          contentHash: hash,
          sizeBytes,
        });
      } catch (error) {
        // Fail closed: the snapshot's bytes are its content-address — if they
        // cannot be stored, the snapshot must not be recorded as if they were.
        // An unavailable object store is the day-26 §3.2 failure surface, so it
        // is *loud* (`object_store_error_total`) before it propagates. A plain
        // bug or an integrity drift is not this signal, so it is merely rethrown.
        if (error instanceof ObjectStoreUnavailableError) {
          recordObjectStoreError();
        }
        throw error;
      }
    }

    const id = newSnapshotID();
    await executor.insert(snapshots).values({
      id,
      change_id: changeId,
      content_hash: hash,
      content: backend === 'db' ? content : null,
      content_backend: backend,
      generation: 1,
    });
    return { snapshotId: id, deduped: false };
  }
}
