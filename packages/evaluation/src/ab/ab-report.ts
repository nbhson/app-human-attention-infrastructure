/**
 * `pnpm eval:ab-report` — Day-29 §3.4, §5 A/B dry-run report CLI.
 *
 * Runs the canonical trajectory fixture(s) through the two context rankers (A =
 * keyword, B = hybrid) behind the shared {@link ContextRanker} seam, records each
 * arm's ranking + `rank_method` + §2.3 outcome signals to the isolated `ab_*`
 * tables, asserts **zero production effect** (live `tasks`/`decisions`/`contexts`
 * rows must not move — arm B's ranking is never written to a served
 * `ContextSnapshot`), and prints the comparison: the §2.3 signal table, the
 * `rank_correlation` distribution, the §2.4 minimum-evidence verdict, and a
 * one-line Day-30 recommendation.
 *
 * `--run <id>` re-emits the report for an already-stored experiment from its
 * `ab_runs.report` jsonb — no replay, no live writes. The stored payload carries the
 * rankings, signals, `top_k`, and the run-time guardrail result, so the re-emitted
 * report is reproducible rather than re-derived from the (since-moved-on) fixtures.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';

import { count, eq } from 'drizzle-orm';
import { config } from 'dotenv';

import {
  abExperiments,
  abRuns,
  AbStore,
  asReadonlyDb,
  contexts,
  createDb,
  decisions,
  tasks,
} from '@harness/db';
import type { AbRunReport, ReadonlyDb } from '@harness/db';

import { loadTrajectory } from '../replay/loader.js';
import { TrajectoryReplayer } from '../trajectory-replayer.js';
import type { ReplayInput } from '../trajectory-replayer.js';
import {
  aggregateSignals,
  DEFAULT_EVIDENCE_BAR,
  evaluateEvidence,
  rankCorrelationDistribution,
  recommend,
} from './outcome-metrics.js';
import type {
  EvidenceBar,
  EvidenceVerdict,
  OutcomeInput,
  OutcomeSignals,
  RankCorrelationDistribution,
  Recommendation,
} from './outcome-metrics.js';
import { deriveRankingCorpus, hybridRanker, keywordRanker } from './ranking-variants.js';

/** The predefined primary scalar the experiment is scored on (day-29 §2.3, first). */
export const RANKING_METRIC = 'context_acceptance_rate';
export const DEFAULT_TOP_K = 5;
const DEFAULT_FIXTURES_DIR = 'fixtures/trajectories';

/** The postgres.js handle `createDb` wraps; `DrizzleDB` drops it, so `--once` needs this. */
type ClosableDb = { $client: { end: () => Promise<unknown> } };

/** One arm's reportable result: the ranker it ran + its signals + its per-input orders. */
export interface ArmReport {
  readonly arm: 'A' | 'B';
  readonly rankMethod: 'keyword' | 'hybrid';
  readonly outcome: OutcomeSignals;
  readonly rankings: readonly (readonly string[])[];
}

/** The full dry-run result, rendered or stored by the CLI. */
export interface RankingDryRunResult {
  readonly experimentId: string;
  readonly metric: string;
  readonly topK: number;
  readonly numInputs: number;
  readonly arms: { readonly A: ArmReport; readonly B: ArmReport };
  readonly rankCorrelation: RankCorrelationDistribution;
  readonly noProductionEffect: boolean;
  readonly evidence: EvidenceVerdict;
  readonly recommendation: Recommendation;
}

export interface RankingDryRunConfig {
  readonly metric?: string;
  readonly topK?: number;
  readonly evidenceBar?: EvidenceBar;
  readonly fixtures: readonly ReplayInput[];
}

/**
 * The Day-29 ranking dry-run harness. Structural shadow isolation as in the Day-9
 * {@link AbHarness}: a {@link ReadonlyDb} (select only) for live reads and an
 * {@link AbStore} (writes only `ab_*`) for results. No live mutation capability
 * exists on this type — the guardrail is enforced twice: by construction, and by
 * the before/after live-count assertion that throws on any movement.
 */
export class RankingDryRun {
  constructor(
    private readonly db: ReadonlyDb,
    private readonly store: AbStore,
  ) {}

  async run(config: RankingDryRunConfig): Promise<RankingDryRunResult> {
    const topK = config.topK ?? DEFAULT_TOP_K;
    const metric = config.metric ?? RANKING_METRIC;
    const bar = config.evidenceBar ?? DEFAULT_EVIDENCE_BAR;

    const before = await this.liveCounts();

    // Replay-drift gate: a divergent trajectory throws before any experiment row.
    const replayed = config.fixtures.map((input) => new TrajectoryReplayer().replay(input));
    const sourceHashes = replayed.map((result) => result.sourceHash);

    const aOrders: string[][] = [];
    const bOrders: string[][] = [];
    const outcomeA: OutcomeInput[] = [];
    const outcomeB: OutcomeInput[] = [];

    for (const input of config.fixtures) {
      const corpus = deriveRankingCorpus(input.trajectory);
      const consumed = [
        ...new Set([...corpus.candidateFiles.map((file) => file.sourceId), ...corpus.targetFiles]),
      ];
      const elapsedMinutes =
        input.trajectory.endTimestamp !== undefined
          ? (input.trajectory.endTimestamp.getTime() - input.trajectory.startTimestamp.getTime()) /
            60_000
          : undefined;

      const aOrder = keywordRanker.rank(corpus).map((source) => source.sourceId);
      const bOrder = hybridRanker.rank(corpus).map((source) => source.sourceId);
      aOrders.push(aOrder);
      bOrders.push(bOrder);
      outcomeA.push(toOutcomeInput(aOrder, consumed, topK, elapsedMinutes));
      outcomeB.push(toOutcomeInput(bOrder, consumed, topK, elapsedMinutes));
    }

    const signalsA = aggregateSignals(outcomeA);
    const signalsB = aggregateSignals(outcomeB);
    const correlation = rankCorrelationDistribution(aOrders, bOrders, topK);

    // The experiment row (fixed metric) is written before the runs (§2.3, §6).
    const experimentId = await this.store.createExperiment({
      variantA: {
        id: 'keyword',
        contextRanker: 'keyword',
        description: 'Phase-1 keyword + dependency-proximity ranker (control)',
      },
      variantB: {
        id: 'hybrid',
        contextRanker: 'hybrid',
        description: 'hybrid ranker — lexical ⊕ semantic fused by RRF, then re-ranked (challenger)',
      },
      metric,
    });

    await this.recordArm(experimentId, 'A', metric, topK, signalsA, aOrders, sourceHashes);
    await this.recordArm(experimentId, 'B', metric, topK, signalsB, bOrders, sourceHashes);

    const after = await this.liveCounts();
    const noProductionEffect =
      before.tasks === after.tasks &&
      before.decisions === after.decisions &&
      before.contexts === after.contexts;

    if (!noProductionEffect) {
      throw new Error(
        `[eval:ab-report] GUARDRAIL VIOLATION: the dry-run moved live rows ` +
          `(tasks ${before.tasks}→${after.tasks}, decisions ${before.decisions}→${after.decisions}, ` +
          `contexts ${before.contexts}→${after.contexts}). Arm B's ranking may never reach a served ` +
          `ContextSnapshot — the comparison is confounded and must be fixed before shipping.`,
      );
    }

    const evidence = evaluateEvidence(bar, config.fixtures.length, correlation, signalsA, signalsB);
    const recommendation = recommend(evidence, signalsA, signalsB);

    return {
      experimentId,
      metric,
      topK,
      numInputs: config.fixtures.length,
      arms: {
        A: { arm: 'A', rankMethod: 'keyword', outcome: signalsA, rankings: aOrders },
        B: { arm: 'B', rankMethod: 'hybrid', outcome: signalsB, rankings: bOrders },
      },
      rankCorrelation: correlation,
      noProductionEffect,
      evidence,
      recommendation,
    };
  }

  private async recordArm(
    experimentId: string,
    arm: 'A' | 'B',
    metric: string,
    topK: number,
    signals: OutcomeSignals,
    rankings: readonly (readonly string[])[],
    sourceHashes: readonly string[],
  ): Promise<void> {
    const variantId = arm === 'A' ? 'A' : 'B';
    const rankMethod = arm === 'A' ? 'keyword' : 'hybrid';
    const metricValue = signals.contextAcceptanceRate ?? 0;
    await this.store.recordRun({
      experimentId,
      variantId,
      metricValue,
      report: {
        variantId,
        metric,
        metricValue,
        trajectories: sourceHashes.length,
        sourceHashes,
        rankMethod,
        rankings,
        outcome: signals,
        topK,
        noProductionEffect: true,
      },
    });
  }

  private async liveCounts(): Promise<{ tasks: number; decisions: number; contexts: number }> {
    const [taskRows, decisionRows, contextRows] = await Promise.all([
      this.db.select({ n: count() }).from(tasks),
      this.db.select({ n: count() }).from(decisions),
      this.db.select({ n: count() }).from(contexts),
    ]);
    return {
      tasks: taskRows[0]?.n ?? 0,
      decisions: decisionRows[0]?.n ?? 0,
      contexts: contextRows[0]?.n ?? 0,
    };
  }
}

function toOutcomeInput(
  order: readonly string[],
  consumed: readonly string[],
  topK: number,
  elapsedMinutes: number | undefined,
): OutcomeInput {
  return {
    injectedOrder: order,
    consumedPaths: consumed,
    topK,
    ...(elapsedMinutes !== undefined ? { elapsedMinutes } : {}),
  };
}

/** Re-emit a report for an already-stored experiment, from its `ab_runs` jsonb. */
export async function loadStoredResult(
  db: ReadonlyDb,
  experimentId: string,
  overrides: { topK?: number; evidenceBar?: EvidenceBar } = {},
): Promise<RankingDryRunResult> {
  const experiment = await db
    .select({ id: abExperiments.id, metric: abExperiments.metric })
    .from(abExperiments)
    .where(eq(abExperiments.id, experimentId))
    .limit(1);
  const row = experiment[0];
  if (row === undefined) throw new Error(`no experiment with id ${experimentId}`);

  const runs = await db.select().from(abRuns).where(eq(abRuns.experiment_id, experimentId));
  const runA = runs.find((run) => run.variant_id === 'A');
  const runB = runs.find((run) => run.variant_id === 'B');
  if (runA === undefined || runB === undefined) {
    throw new Error(`experiment ${experimentId} has incomplete runs (need A and B)`);
  }

  const reportA = runA.report as AbRunReport;
  const reportB = runB.report as AbRunReport;
  const topK = overrides.topK ?? reportA.topK ?? DEFAULT_TOP_K;
  const bar = overrides.evidenceBar ?? DEFAULT_EVIDENCE_BAR;
  const aOrders = reportA.rankings ?? [];
  const bOrders = reportB.rankings ?? [];
  const signalsA = reportA.outcome ?? {};
  const signalsB = reportB.outcome ?? {};
  const correlation = rankCorrelationDistribution(aOrders, bOrders, topK);
  const numInputs = reportA.trajectories;
  const evidence = evaluateEvidence(bar, numInputs, correlation, signalsA, signalsB);
  const recommendation = recommend(evidence, signalsA, signalsB);

  return {
    experimentId,
    metric: row.metric,
    topK,
    numInputs,
    arms: {
      A: {
        arm: 'A',
        rankMethod: (reportA.rankMethod as 'keyword') ?? 'keyword',
        outcome: signalsA,
        rankings: aOrders,
      },
      B: {
        arm: 'B',
        rankMethod: (reportB.rankMethod as 'hybrid') ?? 'hybrid',
        outcome: signalsB,
        rankings: bOrders,
      },
    },
    rankCorrelation: correlation,
    noProductionEffect: reportA.noProductionEffect ?? false,
    evidence,
    recommendation,
  };
}

/** The one-line Day-30 recommendation (§5), backed by the verdict and signals. */
export function recommendationLine(result: RankingDryRunResult): string {
  switch (result.recommendation) {
    case 'promote':
      return 'promote hybrid ranking to the Phase-3 default — it lowers rework without losing context acceptance.';
    case 'real-ab':
      return 'promote hybrid ranking to a real A/B — the ranking differs but the replayed outcome is a toss-up; collect live outcome data before any default switch.';
    case 'keep-shadow':
      return result.evidence.verdict === 'insufficient'
        ? `keep hybrid ranking in shadow — insufficient evidence (${result.evidence.reasons.join('; ')}).`
        : 'keep hybrid ranking in shadow — no measured outcome value yet.';
  }
}

function fmt(value: number | undefined, digits = 3): string {
  return value === undefined ? 'n/a' : value.toFixed(digits);
}

/** Render the result as a plain-text report (the §3.4 output). */
export function renderReport(result: RankingDryRunResult): string {
  const lines: string[] = [];
  lines.push('# A/B dry-run — keyword vs hybrid context ranking');
  lines.push('');
  lines.push(`experiment:   ${result.experimentId}`);
  lines.push(`metric:       ${result.metric}`);
  lines.push(`inputs:       ${result.numInputs}`);
  lines.push(`top-k:        ${result.topK}`);
  lines.push('');
  lines.push('outcome signals (per arm):');
  lines.push(
    `  A keyword:   context_acceptance_rate=${fmt(result.arms.A.outcome.contextAcceptanceRate, 4)}  ` +
      `human_minutes_per_accept=${fmt(result.arms.A.outcome.humanMinutesPerAccept)}  ` +
      `rework_rate=${fmt(result.arms.A.outcome.reworkRate, 4)}`,
  );
  lines.push(
    `  B hybrid:    context_acceptance_rate=${fmt(result.arms.B.outcome.contextAcceptanceRate, 4)}  ` +
      `human_minutes_per_accept=${fmt(result.arms.B.outcome.humanMinutesPerAccept)}  ` +
      `rework_rate=${fmt(result.arms.B.outcome.reworkRate, 4)}`,
  );
  lines.push('');
  const corr = result.rankCorrelation;
  lines.push(
    `rank_correlation (hybrid vs keyword, top-k=${result.topK}): ` +
      `[${corr.values.map((v) => v.toFixed(3)).join(', ')}]`,
  );
  lines.push(
    `  count=${corr.count}  min=${fmt(corr.min)}  max=${fmt(corr.max)}  mean=${fmt(corr.mean)}`,
  );
  lines.push('');
  lines.push(`evidence:      ${result.evidence.verdict.toUpperCase()}`);
  for (const reason of result.evidence.reasons) lines.push(`  - ${reason}`);
  lines.push('');
  lines.push(
    `guardrail:     arm B's ranking never reached a served ContextSnapshot — ` +
      `${result.noProductionEffect ? 'HELD' : 'VIOLATED'} (tasks/decisions/contexts unchanged)`,
  );
  lines.push('');
  lines.push(`recommendation: ${recommendationLine(result)}`);
  return lines.join('\n');
}

function parseArg(argv: readonly string[], flag: string): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

async function loadFixtures(dir: string): Promise<ReplayInput[]> {
  const base = process.env.INIT_CWD ?? process.cwd();
  const resolved = isAbsolute(dir) ? dir : resolve(base, dir);
  const names = (await readdir(resolved)).filter((name) => extname(name) === '.json').sort();
  const inputs: ReplayInput[] = [];
  for (const name of names) {
    const loaded = await loadTrajectory(resolve(resolved, name));
    inputs.push({
      runId: loaded.runId,
      trajectory: loaded.trajectory,
      ...(loaded.recordedHash !== undefined ? { expectedSourceHash: loaded.recordedHash } : {}),
    });
  }
  return inputs;
}

function loadDotenv(): void {
  for (const candidate of ['.env', '../../.env']) {
    const path = resolve(process.cwd(), candidate);
    if (existsSync(path)) {
      config({ path });
      return;
    }
  }
}

async function main(): Promise<void> {
  loadDotenv();

  const args = process.argv.slice(2);
  const runId = parseArg(args, '--run');
  const topKArg = parseArg(args, '--top-k');
  const minTasksArg = parseArg(args, '--min-tasks');
  const fixturesDir = parseArg(args, '--fixtures') ?? DEFAULT_FIXTURES_DIR;
  const asJson = args.includes('--json');

  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  const topK = topKArg !== undefined ? Number(topKArg) : DEFAULT_TOP_K;
  const bar: EvidenceBar =
    minTasksArg !== undefined
      ? { ...DEFAULT_EVIDENCE_BAR, minTasks: Number(minTasksArg) }
      : DEFAULT_EVIDENCE_BAR;

  const db = createDb(connectionString);
  try {
    const readonlyDb = asReadonlyDb(db);
    const result =
      runId !== undefined
        ? await loadStoredResult(readonlyDb, runId, { topK, evidenceBar: bar })
        : await new RankingDryRun(readonlyDb, new AbStore(db)).run({
            topK,
            evidenceBar: bar,
            fixtures: await loadFixtures(fixturesDir),
          });

    console.log(asJson ? JSON.stringify(result, null, 2) : renderReport(result));
  } catch (error: unknown) {
    console.error(`[eval:ab-report] ${String(error)}`);
    process.exitCode = 1;
  } finally {
    await (db as unknown as ClosableDb).$client.end();
  }
}

void main();
