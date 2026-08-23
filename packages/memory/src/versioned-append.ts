/**
 * Versioned append (review-reorient Phase 3, day-17 §2.2 §3.3).
 *
 * Memory is a Git-like append-only chain, never an edit-in-place: re-distilling
 * the same *idea* creates a new {@link MemoryEntry} whose `supersedes` points at
 * the prior head, and whose `confidence` reflects how often the pattern has
 * recurred. The chain key — the "same idea" predicate — is a stable
 * `kind|subject` token stored in `metadata.dedup_key`, so minor wording changes
 * don't split the version chain (day-17 §6).
 *
 * Boundary: this module reads/writes through {@link MemoryStore} (which owns the
 * event publish + evidence-link invariant) rather than touching the db schema
 * directly, so the ≥1-evidence rule stays in one place.
 */

import type { EvidenceID, MemoryEntry, MemoryKind } from '@harness/domain';

import type { DistilledMemory } from './memory-distiller.js';
import { MemoryStore } from './memory-store.js';

/** Confidence added per corroborating recurrence, capped so it never reaches 1.0. */
export const CONFIDENCE_RECURRENCE_INCREMENT = 10;
/** Confidence ceiling — "never set 1.0 (100) by fiat" (day-17 §6). */
export const MAX_CONFIDENCE = 99;

/** The stable identity of a memory idea: `kind|subject`. */
export function memoryDedupKey(kind: MemoryKind, subject: string): string {
  return `${kind}|${subject}`;
}

/**
 * Append one distilled candidate as a new version of its idea. Finds the current
 * chain head (the newest entry sharing the dedup key), links `supersedes` to it,
 * bumps `confidence` by one increment per prior occurrence, and persists via
 * {@link MemoryStore.create} — which still enforces the ≥1-evidence invariant.
 */
export async function appendVersion(
  store: MemoryStore,
  candidate: DistilledMemory,
  evidenceIds: readonly EvidenceID[],
): Promise<MemoryEntry> {
  const dedupKey = memoryDedupKey(candidate.kind, candidate.subject);

  // `listByKind` returns newest-first, so the head is the first sibling (if any).
  const siblings = (await store.listByKind(candidate.kind)).filter(
    (entry) => entry.metadata.dedup_key === dedupKey,
  );
  const head: MemoryEntry | null = siblings[0] ?? null;

  const confidence = Math.min(
    candidate.confidence + siblings.length * CONFIDENCE_RECURRENCE_INCREMENT,
    MAX_CONFIDENCE,
  );

  return store.create({
    kind: candidate.kind,
    content: candidate.content,
    sourceEvidence: evidenceIds,
    confidence,
    // Omit `supersedes` (rather than pass `null`) — `CreateMemoryInput.supersedes`
    // is `MemoryID | undefined`, and the store treats "absent" as "chain head".
    ...(head ? { supersedes: head.id } : {}),
    metadata: { ...candidate.metadata, dedup_key: dedupKey },
  });
}
