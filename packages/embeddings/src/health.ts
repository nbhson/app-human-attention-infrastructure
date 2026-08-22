/**
 * Index health + the read-path freshness guard (day-17 §2.4, §3.4).
 *
 * These functions are pure — they operate over plain projections of the current
 * source set and the stored rows — so they are unit-testable with no database and
 * cheap enough for the CLI to call after a population run to print "is the index
 * complete?" at a glance.
 */

/** The whole index classified against the current source set. */
export interface IndexHealth {
  /** Distinct current sources considered. */
  readonly total: number;
  /** Sources with a completed, hash-matching embedding. */
  readonly embedded: number;
  /** Sources with no embedding yet (never embedded, or seeded-but-pending). */
  readonly pending: number;
  /** Sources with a vector computed from an outdated content version. */
  readonly stale: number;
}

/** A source's identity + its *current* content version. */
export interface SourceSignature {
  readonly sourceId: string;
  readonly contentHash: string;
}

/** The subset of a stored row the guard/health functions need. */
export interface EmbeddingRowSignature {
  readonly sourceId: string;
  readonly contentHash: string;
  /** Whether a vector is present (vs a pending, NULL-embedding row). */
  readonly embedded: boolean;
}

/**
 * Read-path freshness guard (day-17 §2.4): a stored vector is servable only if
 * it is present AND was computed from the current content version. A hash
 * mismatch means the source changed after embedding — the vector is stale and
 * must never be served until the re-embed listener re-computes it.
 */
export function isFreshVector(row: EmbeddingRowSignature, currentHash: string): boolean {
  return row.embedded && row.contentHash === currentHash;
}

/**
 * Classify every current source as `embedded` / `pending` / `stale` against the
 * stored rows. `row.contentHash` is the hash the vector was computed *from*;
 * `source.contentHash` is what the source is *now* (day-17 §2.4).
 */
export function computeIndexHealth(
  sources: readonly SourceSignature[],
  rows: readonly EmbeddingRowSignature[],
): IndexHealth {
  const byId = new Map(rows.map((row) => [row.sourceId, row]));
  let embedded = 0;
  let pending = 0;
  let stale = 0;
  for (const source of sources) {
    const row = byId.get(source.sourceId);
    if (row === undefined || !row.embedded) {
      pending += 1;
    } else if (row.contentHash === source.contentHash) {
      embedded += 1;
    } else {
      stale += 1;
    }
  }
  return { total: sources.length, embedded, pending, stale };
}
