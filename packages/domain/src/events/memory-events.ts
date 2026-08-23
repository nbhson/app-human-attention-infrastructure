/**
 * Review-memory event payloads (review-reorient Phase 3, day-16).
 *
 * Payload shapes for the memory slice. These live here (not in
 * `@harness/event-bus`) so the bus package has zero domain dependencies beyond
 * `@harness/domain` itself.
 */

import type { MemoryID, TaskID } from '../ids.js';
import type { MemoryKind } from '../memory.js';

/** Payload for {@link import('./event-types.js').EventType.MemoryEntryCreated}. */
export interface MemoryEntryCreatedPayload {
  /** The entry that was just written. */
  readonly memory_id: MemoryID;
  /** The tier the entry belongs to (correlated for retrieval fan-in). */
  readonly kind: MemoryKind;
  /** How many evidence links back the entry (the ≥1 invariant). */
  readonly evidence_count: number;
  /** The task the entry was distilled from, or `null` for project context. */
  readonly task_id: TaskID | null;
}

/**
 * Why an entry was archived (day-19 §2.4). Both paths soft-delete: the row stays
 * for audit, retrieval simply stops surfacing it.
 */
export type MemoryArchiveReason = 'below_confidence_threshold' | 'consolidated';

/** Payload for {@link import('./event-types.js').EventType.MemoryConsolidated}. */
export interface MemoryConsolidatedPayload {
  /** The surviving head of the version chain. */
  readonly memory_id: MemoryID;
  /** The tier the head belongs to. */
  readonly kind: MemoryKind;
  /** The superseded versions folded into `memory_id` (now `ARCHIVED`). */
  readonly archived_ids: readonly MemoryID[];
  /** Evidence links folded from the superseded versions into the head. */
  readonly evidence_count: number;
}

/** Payload for {@link import('./event-types.js').EventType.MemoryArchived}. */
export interface MemoryArchivedPayload {
  /** The entry moved to `ARCHIVED`. */
  readonly memory_id: MemoryID;
  /** The tier the archived entry belongs to. */
  readonly kind: MemoryKind;
  /** Why the entry was archived. */
  readonly reason: MemoryArchiveReason;
}
