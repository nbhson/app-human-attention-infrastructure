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
