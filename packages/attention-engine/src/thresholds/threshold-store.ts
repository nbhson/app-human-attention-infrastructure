/**
 * Append-only, versioned store for the adaptive review thresholds (day-13 §2.2).
 *
 * The HIGH/CRITICAL cutoffs are **never UPDATEd**. Every change (including a
 * revert) INSERTs a new row whose `supersedes` points at the value it replaces,
 * so the full "who moved what, when, and why" history is a plain SELECT over
 * this table. `getActive` reads the most recent row for `(project, band)`;
 * `revert` re-applies the previous value as a *new* row, keeping the chain
 * intact rather than rewinding it.
 */

import { and, desc, eq } from 'drizzle-orm';

import { attentionThresholds } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { uuidv7 } from '@harness/domain';
import type { ThresholdBand } from '@harness/domain';

/** One persisted threshold value (read shape — snake_case columns mapped). */
export interface ThresholdRecord {
  readonly id: string;
  readonly projectId: string;
  readonly band: ThresholdBand;
  readonly cutoff: number;
  readonly minBounds: number;
  readonly maxBounds: number;
  readonly reason: string;
  /** The row this value replaces, or `null` for the initial seed. */
  readonly supersedes: string | null;
  readonly appliedAt: Date;
}

/** The input to {@link ThresholdStore.apply}. */
export interface ThresholdApply {
  readonly band: ThresholdBand;
  readonly cutoff: number;
  readonly minBounds: number;
  readonly maxBounds: number;
  readonly reason: string;
}

/** Map a `drizzle` row to the engine-local {@link ThresholdRecord}. */
function toRecord(row: typeof attentionThresholds.$inferSelect): ThresholdRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    band: row.band as ThresholdBand,
    cutoff: row.cutoff,
    minBounds: row.min_bounds,
    maxBounds: row.max_bounds,
    reason: row.reason,
    supersedes: row.supersedes,
    appliedAt: row.applied_at,
  };
}

export class ThresholdStore {
  constructor(private readonly db: DrizzleDB) {}

  /** The current value for `(project, band)`, or `null` before any adjustment. */
  async getActive(projectId: string, band: ThresholdBand): Promise<ThresholdRecord | null> {
    const rows = await this.db
      .select()
      .from(attentionThresholds)
      .where(and(eq(attentionThresholds.project_id, projectId), eq(attentionThresholds.band, band)))
      // Most-recent first; `id` is UUIDv7 (time-ordered) so it tie-breaks equal stamps.
      .orderBy(desc(attentionThresholds.applied_at), desc(attentionThresholds.id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /**
   * Insert a new value for `(project, band)`, superseding the current active row.
   * The first value for a band has `supersedes === null`.
   */
  async apply(projectId: string, input: ThresholdApply): Promise<ThresholdRecord> {
    const active = await this.getActive(projectId, input.band);
    const id = uuidv7();
    await this.db.insert(attentionThresholds).values({
      id,
      project_id: projectId,
      band: input.band,
      cutoff: input.cutoff,
      min_bounds: input.minBounds,
      max_bounds: input.maxBounds,
      reason: input.reason,
      supersedes: active?.id ?? null,
    });
    return {
      id,
      projectId,
      band: input.band,
      cutoff: input.cutoff,
      minBounds: input.minBounds,
      maxBounds: input.maxBounds,
      reason: input.reason,
      supersedes: active?.id ?? null,
      appliedAt: new Date(),
    };
  }

  /**
   * Restore the value that preceded the current active one as a *new* row. The
   * history is append-only, so a revert is itself reversible: the restored
   * value's `supersedes` points at the row it undoes. Returns `null` when there
   * is no previous value to return to.
   */
  async revert(projectId: string, band: ThresholdBand): Promise<ThresholdRecord | null> {
    const rows = await this.db
      .select()
      .from(attentionThresholds)
      .where(and(eq(attentionThresholds.project_id, projectId), eq(attentionThresholds.band, band)))
      .orderBy(desc(attentionThresholds.applied_at), desc(attentionThresholds.id))
      .limit(2);
    const previous = rows[1];
    if (previous === undefined) {
      return null;
    }
    return this.apply(projectId, {
      band,
      cutoff: previous.cutoff,
      minBounds: previous.min_bounds,
      maxBounds: previous.max_bounds,
      reason: `revert to ${previous.cutoff} (supersedes ${previous.id})`,
    });
  }

  /** Full `(project, band)` history, oldest first — the audit trail. */
  async history(projectId: string, band: ThresholdBand): Promise<ThresholdRecord[]> {
    const rows = await this.db
      .select()
      .from(attentionThresholds)
      .where(and(eq(attentionThresholds.project_id, projectId), eq(attentionThresholds.band, band)))
      .orderBy(attentionThresholds.applied_at, attentionThresholds.id);
    return rows.map(toRecord);
  }
}
