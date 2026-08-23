/**
 * Chain consolidation (review-reorient Phase 3, day-19 §2.2 §3.2).
 *
 * Versions on a `supersedes` chain are the *same idea* re-distilled (day-17), so
 * keeping every link live would let one stale finding crowd out its own updates.
 * Consolidation folds the superseded versions into the chain **head**: their
 * `sourceEvidence` links merge into the head's link set (deduped by the
 * `memory_entry_evidence` UNIQUE index), the head's `confidence` becomes the
 * chain max, and the superseded rows move to `ARCHIVED` (soft-delete — retained
 * for audit, excluded from retrieval by the store's `ACTIVE` filter).
 *
 * Evidence is *merged, never dropped*: the head already carries ≥1 link, and we
 * only add more, so the day-16 ≥1 provenance invariant survives the fold.
 * Idempotent — a second tick finds no live superseded rows and is a no-op.
 */

import { eq, inArray } from 'drizzle-orm';

import { memoryEntries, memoryEntryEvidence } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { EventType, brand, uuidv7 } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';

/** Aggregate result of one consolidation pass. */
export interface ConsolidateResult {
  /** Distinct chains folded into a single head. */
  readonly mergedChains: number;
  /** Superseded versions moved to `ARCHIVED`. */
  readonly archived: number;
  /** Evidence links folded into heads (before the unique-index dedup). */
  readonly foldedLinks: number;
}

/** The row shape `memory_entries` selects back. */
type MemoryEntryRow = typeof memoryEntries.$inferSelect;

/**
 * Fold every active `supersedes` chain into its head: merge evidence links,
 * aggregate confidence to the chain max, archive the superseded rows, and
 * publish `memory.consolidated` per head.
 */
export async function consolidateChains(
  db: DrizzleDB,
  bus: IEventBus,
  logger?: Logger,
): Promise<ConsolidateResult> {
  const rows = await db.select().from(memoryEntries).where(eq(memoryEntries.status, 'ACTIVE'));

  // A linear append chain (day-17) has at most one superseder per target: the
  // next version. Map `supersedes` target → the version superseding it.
  const supersededBy = new Map<string, string>();
  for (const row of rows) {
    if (row.supersedes !== null) {
      supersededBy.set(row.supersedes, row.id);
    }
  }

  // The rows that are *themselves* superseded (referenced as a `supersedes`
  // target), i.e. every link in a chain except its head.
  const supersededIds = new Set(supersededBy.keys());
  const supersededRows = rows.filter((row) => supersededIds.has(row.id));
  if (supersededRows.length === 0) {
    return { mergedChains: 0, archived: 0, foldedLinks: 0 };
  }

  // Follow the superseder edges to the ultimate head of a chain.
  const headOf = (id: string): string => {
    let current = id;
    let guard = 0;
    while (supersededBy.has(current) && guard < rows.length) {
      current = supersededBy.get(current) as string;
      guard += 1;
    }
    return current;
  };

  const byHead = new Map<string, MemoryEntryRow[]>();
  for (const row of supersededRows) {
    const headId = headOf(row.id);
    if (headId === row.id) {
      continue; // safety: cannot fold a head into itself
    }
    const list = byHead.get(headId) ?? [];
    list.push(row);
    byHead.set(headId, list);
  }

  let foldedLinks = 0;
  let archived = 0;
  for (const [headId, superseded] of byHead) {
    const headRow = rows.find((row) => row.id === headId);
    if (!headRow) {
      continue;
    }

    // Fold each superseded row's evidence into the head (idempotent via UNIQUE).
    let headFolded = 0;
    for (const row of superseded) {
      const links = await db
        .select()
        .from(memoryEntryEvidence)
        .where(eq(memoryEntryEvidence.memory_entry_id, row.id));
      if (links.length > 0) {
        await db
          .insert(memoryEntryEvidence)
          .values(
            links.map((link) => ({
              id: uuidv7(),
              memory_entry_id: headId,
              evidence_id: link.evidence_id,
            })),
          )
          .onConflictDoNothing({
            target: [memoryEntryEvidence.memory_entry_id, memoryEntryEvidence.evidence_id],
          });
        headFolded += links.length;
      }
    }
    foldedLinks += headFolded;

    // Aggregate confidence to the chain max; the head already carries the
    // recurrence bump (day-17), this only protects multi-superseder chains.
    const chainMax = Math.max(headRow.confidence, ...superseded.map((row) => row.confidence));
    if (chainMax !== headRow.confidence) {
      await db
        .update(memoryEntries)
        .set({ confidence: chainMax })
        .where(eq(memoryEntries.id, headId));
    }

    // Archive the superseded versions (soft-delete, retained for audit).
    const archivedIds = superseded.map((row) => row.id);
    await db
      .update(memoryEntries)
      .set({ status: 'ARCHIVED' })
      .where(inArray(memoryEntries.id, archivedIds));
    archived += superseded.length;

    bus.publish(
      createEvent(EventType.MemoryConsolidated, brand(headId, 'CorrelationID'), {
        memory_id: brand(headId, 'MemoryID'),
        kind: headRow.kind,
        archived_ids: archivedIds.map((id) => brand(id, 'MemoryID')),
        evidence_count: headFolded,
      }),
    );
    logger?.debug('memory: chain consolidated', {
      memory_id: headId,
      archived: superseded.length,
    });
  }

  return {
    mergedChains: byHead.size,
    archived,
    foldedLinks,
  };
}
