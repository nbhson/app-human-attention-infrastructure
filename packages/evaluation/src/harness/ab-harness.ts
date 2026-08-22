/**
 * A/B shadow harness (day-09 §2.2, §3.3).
 *
 * Runs two {@link PipelineVariant}s over the same replayed trajectories, writes
 * the comparison to the isolated `ab_experiments`/`ab_runs` tables, and emits a
 * go/no-go outcome. "Shadow" is a *write-boundary property*, not a config flag:
 * the constructor takes a {@link ReadonlyDb} (no INSERT/UPDATE/DELETE exists on
 * that type) and an {@link AbStore} (which writes only the two `ab_*` tables), and
 * it takes **no event bus**. A variant run that tries to publish would not even
 * resolve — the parameter never exists to be passed.
 */

import { count } from 'drizzle-orm';

import { decisions, tasks } from '@harness/db';
import type { AbRunReport, AbStore, ReadonlyDb } from '@harness/db';

import { ReplayDivergenceError } from '../replay/errors.js';
import { TrajectoryReplayer } from '../trajectory-replayer.js';
import type { ReplayInput, ReplayResult } from '../trajectory-replayer.js';
import { compare } from './compare.js';
import type { AbOutcome } from './compare.js';
import type { PipelineVariant } from './variant.js';
import { metricForVariant } from './variant.js';

export interface AbExperiment {
  readonly name: string;
  readonly variantA: PipelineVariant;
  readonly variantB: PipelineVariant;
  /** The single predefined comparison metric (§2.3), fixed before runs execute. */
  readonly metric: string;
  /** The replayed trajectories both variants are scored over. */
  readonly inputs: readonly ReplayInput[];
}

function runReport(
  variantId: 'A' | 'B',
  metric: string,
  metricValue: number,
  replayed: readonly ReplayResult[],
): AbRunReport {
  return {
    variantId,
    metric,
    metricValue,
    trajectories: replayed.length,
    sourceHashes: replayed.map((result) => result.sourceHash),
  };
}

export class AbHarness {
  constructor(
    private readonly db: ReadonlyDb,
    private readonly store: AbStore,
  ) {}

  async run(experiment: AbExperiment): Promise<AbOutcome> {
    // Isolation is measured, not assumed (§2.2, §5): snapshot live row counts
    // before and after the run and assert they did not move.
    const before = await this.liveCounts();

    // Replay-drift gate (§6): a divergent trajectory throws before any experiment
    // row is written, so drift can't later masquerade as "B beat A".
    let replayed: ReplayResult[];
    try {
      replayed = experiment.inputs.map((input) => new TrajectoryReplayer().replay(input));
    } catch (error: unknown) {
      if (error instanceof ReplayDivergenceError) {
        throw error;
      }
      throw new ReplayDivergenceError(`unexpected replay failure: ${String(error)}`);
    }

    // The experiment row — with its fixed `metric` — is written before the runs
    // execute (§2.3, §6): there is no UPDATE path and no post-hoc metric shopping.
    const experimentId = await this.store.createExperiment({
      variantA: experiment.variantA,
      variantB: experiment.variantB,
      metric: experiment.metric,
    });

    const aValue = metricForVariant(experiment.variantA, experiment.inputs);
    const bValue = metricForVariant(experiment.variantB, experiment.inputs);

    await this.store.recordRun({
      experimentId,
      variantId: 'A',
      metricValue: aValue,
      report: runReport('A', experiment.metric, aValue, replayed),
    });
    await this.store.recordRun({
      experimentId,
      variantId: 'B',
      metricValue: bValue,
      report: runReport('B', experiment.metric, bValue, replayed),
    });

    const after = await this.liveCounts();
    const noProductionEffect = before.tasks === after.tasks && before.decisions === after.decisions;

    return compare({
      experimentId,
      metric: experiment.metric,
      aValue,
      bValue,
      noProductionEffect,
    });
  }

  private async liveCounts(): Promise<{ tasks: number; decisions: number }> {
    const [taskRows, decisionRows] = await Promise.all([
      this.db.select({ n: count() }).from(tasks),
      this.db.select({ n: count() }).from(decisions),
    ]);
    return { tasks: taskRows[0]?.n ?? 0, decisions: decisionRows[0]?.n ?? 0 };
  }
}
