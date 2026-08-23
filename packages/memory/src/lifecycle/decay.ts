/**
 * Confidence decay (review-reorient Phase 3, day-19 §2.3 §3.3).
 *
 * A memory left un-used should lose *rank*, not its existence: decay multiplies
 * `confidence` by an exponential taper as the entry ages past its last
 * retrieval or corroboration, down to the entry's own `confidence_floor` — never
 * to zero, and never silently raising a low entry (the floor clamps both ways).
 *
 * `Δt` is the time since the entry's last *corroboration or retrieval*: the
 * more recent of `created_at` and `last_retrieved_at`. Entries touched within
 * the grace window are skipped, so freshly-served memory doesn't immediately
 * start fading. Pure and idempotent by construction — a given `now` always
 * computes the same `confidence`, and a re-run converges on the floor.
 */

import { eq } from 'drizzle-orm';

import { memoryEntries } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

/** Default exponential factor per day of inactivity (§2.3). */
const DEFAULT_DECAY_FACTOR_PER_DAY = 0.99;
/** Entries touched within this many days are skipped (recently-retrieved rule). */
const DEFAULT_DECAY_GRACE_DAYS = 7;

/** Tuning knobs for one decay pass. */
export interface DecayOptions {
  /** The "now" the ages are measured from (injectable for tests). */
  readonly now?: Date;
  /** Per-day exponential factor in `(0, 1)` — lower decays faster. */
  readonly factorPerDay?: number;
  /** Skip entries touched within this many days. */
  readonly graceDays?: number;
}

/** Aggregate result of one decay pass. */
export interface DecayResult {
  /** Entries whose `confidence` was reduced. */
  readonly decayed: number;
  /** Active entries skipped (inside the grace window or already at floor). */
  readonly skipped: number;
}

/** True when two numbers are equal within a tiny epsilon (avoids FP drift). */
function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

/**
 * Reduce the `confidence` of active entries past the grace window, floored at
 * each entry's own `confidence_floor`. Idempotent: returns the plain counts.
 */
export async function applyDecay(db: DrizzleDB, options: DecayOptions = {}): Promise<DecayResult> {
  const now = options.now ?? new Date();
  const factor = options.factorPerDay ?? DEFAULT_DECAY_FACTOR_PER_DAY;
  const graceDays = options.graceDays ?? DEFAULT_DECAY_GRACE_DAYS;

  const rows = await db.select().from(memoryEntries).where(eq(memoryEntries.status, 'ACTIVE'));

  let decayed = 0;
  let skipped = 0;
  for (const row of rows) {
    const retrievedMs = row.last_retrieved_at?.getTime() ?? 0;
    const lastTouchedMs = Math.max(row.created_at.getTime(), retrievedMs);
    const ageDays = (now.getTime() - lastTouchedMs) / 86_400_000;

    if (ageDays <= graceDays) {
      skipped += 1;
      continue;
    }

    const tapered = Math.round(row.confidence * Math.pow(factor, ageDays));
    const floored = Math.max(tapered, row.confidence_floor);
    const next = Math.min(floored, row.confidence); // never raise a weak entry

    if (approxEqual(next, row.confidence)) {
      skipped += 1;
      continue;
    }

    await db.update(memoryEntries).set({ confidence: next }).where(eq(memoryEntries.id, row.id));
    decayed += 1;
  }

  return { decayed, skipped };
}
