import type { DrizzleDB } from './client.js';

/**
 * Compile-time read-only view of the live database (day-09 §2.2).
 *
 * The A/B harness resolves *only* this surface, so it cannot INSERT, UPDATE, or
 * DELETE a live row — the mutating methods simply do not exist on the type.
 * `select` is the lone exposed operation; a harness that needs to write must go
 * through the isolated {@link AbStore}, which targets `ab_experiments`/`ab_runs`
 * and never the live domain tables.
 */
export type ReadonlyDb = Pick<DrizzleDB, 'select'>;

/** Narrow a full {@link DrizzleDB} down to its read-only surface (an identity). */
export function asReadonlyDb(db: DrizzleDB): ReadonlyDb {
  return db;
}
