import { uuidv7 } from '@harness/domain';

import type { DrizzleDB } from './client.js';
import { abExperiments, abRuns } from './schema/index.js';

/**
 * The A/B harness's *only* write surface (day-09 §2.2, §3.3).
 *
 * This store owns the two `ab_*` tables and nothing else. Keeping the `.insert()`
 * calls here — rather than inside `@harness/evaluation`'s `harness/` folder —
 * is what makes the isolation guarantee structural: the harness resolves a
 * {@link ReadonlyDb} for live data and this store for results, so the very
 * capability to mutate a `tasks`/`decisions` row is absent from the harness's
 * types. There is no UPDATE or DELETE anywhere in this module (day-09 §6).
 */

/**
 * Day-29 §2.3 outcome signals, computed per arm over the replayed inputs. Each is
 * `undefined` (an honest hole) when its denominator is empty — never `NaN`/`0`
 * padding. These are the *outcome* comparison basis; `rank_correlation` is a cheap
 * screen and lives on the experiment's run pair, not a single arm.
 */
export interface AbOutcomeSignals {
  /** Precision: share of the injected top-k that the run actually consumed. */
  readonly contextAcceptanceRate?: number;
  /** Dry-run dwell proxy: recorded minutes scaled by the rework miss ratio. */
  readonly humanMinutesPerAccept?: number;
  /** Recall-miss: share of inputs whose consumed files missed the top-k. */
  readonly reworkRate?: number;
}

/** A run's self-describing payload: enough to reproduce the experiment result. */
export interface AbRunReport {
  readonly variantId: 'A' | 'B';
  readonly metric: string;
  readonly metricValue: number;
  readonly trajectories: number;
  readonly sourceHashes: readonly string[];
  /**
   * Day-29 ranking dry-run additions (optional — the Day-9/10 demo omits them).
   * Present only when the experiment varies the context ranker, so a historical
   * `ab_runs.report` stays self-describing for the `eval:ab-report --run` read-back.
   */
  readonly rankMethod?: 'keyword' | 'semantic' | 'hybrid';
  /** Per-input ranked orderings (sourceIds, best-first) — the arm's recorded ranking. */
  readonly rankings?: readonly (readonly string[])[];
  readonly outcome?: AbOutcomeSignals;
  /** The injected-context size both arms truncated to (correlation is top-k). */
  readonly topK?: number;
  /** Assigned at run time: live `tasks`/`decisions`/`contexts` counts did not move. */
  readonly noProductionEffect?: boolean;
}

export interface CreateExperimentInput {
  /** Full {@link PipelineVariant} snapshots (JSON documents, not foreign keys). */
  readonly variantA: unknown;
  readonly variantB: unknown;
  /** The single predefined comparison metric, fixed before runs execute. */
  readonly metric: string;
}

export interface RecordRunInput {
  readonly experimentId: string;
  readonly variantId: 'A' | 'B';
  readonly metricValue: number;
  readonly report: AbRunReport;
}

export class AbStore {
  constructor(private readonly db: DrizzleDB) {}

  /** Insert the experiment row (with its fixed `metric`) and return its id. */
  async createExperiment(input: CreateExperimentInput): Promise<string> {
    const id = uuidv7();
    await this.db.insert(abExperiments).values({
      id,
      variant_a: input.variantA,
      variant_b: input.variantB,
      metric: input.metric,
    });
    return id;
  }

  /** Append one variant's run result to the experiment. */
  async recordRun(input: RecordRunInput): Promise<void> {
    await this.db.insert(abRuns).values({
      id: uuidv7(),
      experiment_id: input.experimentId,
      variant_id: input.variantId,
      metric_value: input.metricValue,
      report: input.report,
    });
  }
}
