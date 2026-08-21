/**
 * `SnapshotStore` (day-14 §2.2) — content-addressed, deduplicated snapshot
 * storage.
 *
 * Agents routinely rewrite identical content (no-op edits, formatter passes), so
 * snapshots are keyed by SHA-256 and looked up before insert: capturing the same
 * bytes twice yields exactly one `snapshots` row. The hash doubles as a
 * tamper-evident content identity for verification and rollback.
 *
 * `save` takes the *executor* (the top-level `DrizzleDB` in unit tests, or the
 * open transaction handed to it by `ArtifactTracker.capture`) so the snapshot
 * insert lands in the same atomic unit as the change + artifact writes — a crash
 * can never leave an artifact pointing at a snapshot that was never committed.
 */

import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { brand, newSnapshotID } from '@harness/domain';
import type { ChangeID, SnapshotID } from '@harness/domain';
import { snapshots } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

/** The query operations `save` needs: satisfied by both `DrizzleDB` and its transaction. */
export type SnapshotExecutor = Pick<DrizzleDB, 'select' | 'insert'>;

/** SHA-256 of `content`, hex-encoded (dedup + integrity identity). */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Result of a snapshot save: the row's id and whether it was already present. */
export interface SnapshotResult {
  readonly snapshotId: SnapshotID;
  readonly deduped: boolean;
}

export class SnapshotStore {
  /**
   * Save `content` for `changeId`, deduplicating by content hash. If any
   * snapshot already holds these bytes, return it without inserting a copy.
   */
  async save<T extends SnapshotExecutor>(
    executor: T,
    changeId: ChangeID,
    content: string,
  ): Promise<SnapshotResult> {
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

    const id = newSnapshotID();
    await executor.insert(snapshots).values({
      id,
      change_id: changeId,
      content_hash: hash,
      content,
      generation: 1,
    });
    return { snapshotId: id, deduped: false };
  }
}
