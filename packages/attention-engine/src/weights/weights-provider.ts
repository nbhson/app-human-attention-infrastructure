/**
 * `WeightsProvider` seam (day-12 §2.3, §3.1, §3.5, day-41 CF-2).
 *
 * The Attention Engine's combined-priority formula is *linear in the five
 * weights*, so the weight vector is the one parameter worth isolating behind a
 * seam. Day 12 fits a data-derived vector (see `@harness/evaluation`) but does
 * **not** flip it live; today the provider returns the Phase-1 placeholder, so
 * the engine's behaviour is byte-for-byte unchanged (day-12 §6: shadow-then-
 * default — fit and measure first, promote only after Day 13/14 gate it).
 *
 * CF-2 (day-41): when `FITTED_WEIGHTS_ENABLED=1`, {@link DbWeightsProvider}
 * reads the latest promotion-worthy row from `calibration_weights` and returns
 * it. A failed fit or missing row falls back to the placeholder.
 *
 * The seam is deliberately a promise-returning interface: a future active-
 * weights row (or an env overridden vector) will be read asynchronously without
 * disturbing the synchronous scoring math in `scoring.ts`.
 */

import { PRIORITY_WEIGHTS } from '../types.js';
import type { AttentionWeights } from '../types.js';
import { desc, and, lt, sql } from 'drizzle-orm';
import type { Logger } from '@harness/di';

/** Resolves the currently-active attention weight vector. */
export interface WeightsProvider {
  getActiveWeights(): Promise<AttentionWeights>;
}

/**
 * The default provider: returns a fixed vector (the Phase-1 placeholder) every
 * time. Constructed with no argument in DI; the optional `weights` override is
 * for tests that want to exercise `computePriority` with a fitted vector without
 * standing up a DB-backed provider.
 */
export class StaticWeightsAdapter implements WeightsProvider {
  constructor(private readonly weights: AttentionWeights = PRIORITY_WEIGHTS) {}

  async getActiveWeights(): Promise<AttentionWeights> {
    return this.weights;
  }
}

/**
 * DB-backed provider (CF-2, day-41): reads the latest `calibration_weights` row
 * whose `ranking_accuracy_fitted` strictly beats the placeholder. Falls back to
 * the Phase-1 placeholder when no suitable row exists or the DB is unavailable.
 *
 * The 7-day hold period (`MIN_AGE_MS`) prevents a freshly-fitted vector from
 * being promoted before enough outcome data has accumulated to validate it.
 */
export class DbWeightsProvider implements WeightsProvider {
  constructor(
    private readonly resolveDb: () => import('@harness/db').DrizzleDB,
    private readonly logger: Logger,
    private readonly minAgeMs = 7 * 24 * 60 * 60 * 1000,
  ) {}

  async getActiveWeights(): Promise<AttentionWeights> {
    try {
      const { calibrationWeights } = await import('@harness/db');
      const db = this.resolveDb();
      const sevenDaysAgo = sql`now() - (${this.minAgeMs} || 'milliseconds')::interval`;
      const [row] = await db
        .select()
        .from(calibrationWeights)
        .where(
          and(
            sql`${calibrationWeights.ranking_accuracy_fitted} > ${calibrationWeights.ranking_accuracy_placeholder} + 0.001`,
            lt(calibrationWeights.created_at, sevenDaysAgo),
          ),
        )
        .orderBy(desc(calibrationWeights.created_at))
        .limit(1);
      if (row?.weights) {
        this.logger.info('Fitted weights promoted from calibration_weights', {
          event_type: 'weights_promoted',
          weight_id: row.id,
          dataset_id: row.dataset_id,
          ranking_accuracy_fitted: row.ranking_accuracy_fitted,
          ranking_accuracy_placeholder: row.ranking_accuracy_placeholder,
          age_hours: Math.round((Date.now() - new Date(row.created_at).getTime()) / 3_600_000),
        });
        return row.weights as AttentionWeights;
      }
      this.logger.debug('No qualifying fitted weights found, using placeholder', {
        event_type: 'weights_fallback_placeholder',
        reason: 'no_qualifying_row',
      });
    } catch (err) {
      this.logger.warn('DB error reading fitted weights, falling back to placeholder', {
        event_type: 'weights_fallback_placeholder',
        reason: 'db_error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return PRIORITY_WEIGHTS;
  }
}
