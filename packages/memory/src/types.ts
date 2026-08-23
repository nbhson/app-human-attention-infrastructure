/**
 * The `@harness/memory` public input contract (review-reorient Phase 3, day-16).
 */

import type { EvidenceID, MemoryID, MemoryKind, TaskID } from '@harness/domain';

/** Input for {@link import('./memory-store.js').MemoryStore.create}. */
export interface CreateMemoryInput {
  readonly kind: MemoryKind;
  /** The curated, searchable summary — not a raw log/diff. */
  readonly content: string;
  /** Evidence rows this entry is distilled from (≥1, enforced at write time). */
  readonly sourceEvidence: readonly EvidenceID[];
  /** Confidence in the entry (0–100), defaults to 0. */
  readonly confidence?: number;
  /** Expiry, defaults to `null` (durable). */
  readonly expiresAt?: Date;
  /** The version this entry supersedes, defaults to `null` (chain head). */
  readonly supersedes?: MemoryID;
  /** Kind-specific fields, defaults to `{}`. */
  readonly metadata?: Record<string, unknown>;
  /** The task the entry was distilled from (event correlation), if any. */
  readonly taskId?: TaskID;
}

/** Thrown by {@link import('./memory-store.js').MemoryStore.create} on zero evidence links. */
export class EmptySourceEvidenceError extends Error {
  constructor() {
    super('a memory entry requires at least one source evidence link');
    this.name = 'EmptySourceEvidenceError';
  }
}
