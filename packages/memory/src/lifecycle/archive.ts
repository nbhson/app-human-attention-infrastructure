/**
 * Archive below threshold (review-reorient Phase 3, day-19 §2.4 §3.4).
 *
 * Soft-delete: an entry whose `confidence` has fallen below the utility
 * threshold moves to `ARCHIVED`. The row is retained for audit but excluded
 * from retrieval (the store's `ACTIVE` filter). This is the last lifecycle
 * stage — consolidation archives superseded versions, decay lowers stale
 * confidence, and archive finishes the drop. Idempotent: a second pass finds
 * no active below-threshold rows and is a no-op.
 */

import { and, lt, eq, inArray } from 'drizzle-orm';

import { memoryEntries } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { EventType, brand } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';

/** Default `confidence` below which an active entry is archived. */
export const DEFAULT_ARCHIVE_THRESHOLD = 5;

/** Tuning knobs for one archive pass. */
export interface ArchiveOptions {
  /** Confidence strictly below this value is archived. */
  readonly threshold?: number;
}

/** Aggregate result of one archive pass. */
export interface ArchiveResult {
  /** Entries moved to `ARCHIVED`. */
  readonly archived: number;
}

/**
 * Archive every active entry whose `confidence` is below the threshold and
 * publish `memory.archived` for each (reason `below_confidence_threshold`).
 */
export async function archiveBelowThreshold(
  db: DrizzleDB,
  bus: IEventBus,
  options: ArchiveOptions = {},
  logger?: Logger,
): Promise<ArchiveResult> {
  const threshold = options.threshold ?? DEFAULT_ARCHIVE_THRESHOLD;

  const rows = await db
    .select()
    .from(memoryEntries)
    .where(and(eq(memoryEntries.status, 'ACTIVE'), lt(memoryEntries.confidence, threshold)));

  // One batched UPDATE for every stale row (an `inArray` touch of the whole
  // page), then per-row audit events. The write is a single round-trip instead
  // of one per row; the events stay per-row so provenance never merges.
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await db.update(memoryEntries).set({ status: 'ARCHIVED' }).where(inArray(memoryEntries.id, ids));
  }

  for (const row of rows) {
    bus.publish(
      createEvent(EventType.MemoryArchived, brand(row.id, 'CorrelationID'), {
        memory_id: brand(row.id, 'MemoryID'),
        kind: row.kind,
        reason: 'below_confidence_threshold',
      }),
    );
    logger?.debug('memory: entry archived', { memory_id: row.id, kind: row.kind });
  }

  return { archived: rows.length };
}
