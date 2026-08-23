/**
 * Version-chain resolution (review-reorient Phase 3, day-18 §2.2 §3.2).
 *
 * Memory is append-only (day-16/17): re-distilling the same *idea* writes a new
 * version that `supersedes` the prior head, so `memory_entries` holds the full
 * audit history. Retrieval must surface the **head** of each chain — one memory
 * per idea — and leave the superseded versions queryable by id but out of the
 * ranked result set.
 *
 * A head is simply the entry of a chain that no *other* entry in the set
 * supersedes. That holds regardless of whether the chain's earlier links are
 * themselves present (a full set) or already filtered (a head whose predecessor
 * was dropped from the batch).
 */

import type { MemoryEntry } from '@harness/domain';

/**
 * Return only the head of each `supersedes` chain in `entries` — every entry not
 * referenced as the `supersedes` target of another entry in the same set.
 * Deterministic (no time/randomness); order is the caller's to preserve.
 */
export function resolveChainHeads(entries: readonly MemoryEntry[]): MemoryEntry[] {
  const superseded = new Set<string>();
  for (const entry of entries) {
    if (entry.supersedes !== null) {
      superseded.add(entry.supersedes);
    }
  }
  return entries.filter((entry) => !superseded.has(entry.id));
}
