/**
 * `pnpm eval:fit --dataset <id> [--seed 42] [--val 0.2]` (day-12 §3.3, §5).
 *
 * Fits the five Attention weights from a frozen Day-11 calibration dataset,
 * persists a `calibration_weights` row (append-only — every run INSERTs a new
 * version), and prints the before/after `FitReport` (placeholder vs fitted
 * log-loss + ranking accuracy, plus the governance note when the fit does not
 * beat the placeholder). Read-only over the dataset; the only write is this
 * run's `calibration_weights` row.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';
import { desc, eq } from 'drizzle-orm';

import { calibrationDatasets, calibrationRows, calibrationWeights, createDb } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { uuidv7 } from '@harness/domain';

import type { FactorScores } from './calibration/extractor.js';
import { FIT_METHOD, buildFitReport } from './calibration/fit-report.js';
import { binaryLabel, fitWeights, toFeatureVector } from './calibration/weight-fitter.js';
import type { FitConfig, FitSample } from './calibration/weight-fitter.js';

for (const candidate of ['.env', '../../.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    config({ path });
    break;
  }
}

/** The postgres.js handle `createDb` wraps; drained here so the process exits. */
type ClosableDb = { $client: { end: () => Promise<unknown> } };

const DEFAULT_SEED = 42;
const DEFAULT_VALIDATION_SHARE = 0.2;
const DEFAULT_ITERATIONS = 5000;
const DEFAULT_LEARNING_RATE = 0.1;
const DEFAULT_REGULARIZATION = 0.01;

/** `--dataset` (optional — defaults to the most recent dataset) / `--seed` / `--val`. */
function parseArgs(argv: readonly string[]): { datasetId: string | null; config: FitConfig } {
  let datasetId: string | null = null;
  let seed = DEFAULT_SEED;
  let validationShare = DEFAULT_VALIDATION_SHARE;
  for (const arg of argv) {
    if (arg.startsWith('--dataset=')) datasetId = arg.slice('--dataset='.length);
    else if (arg.startsWith('--seed=')) seed = Number.parseInt(arg.slice('--seed='.length), 10);
    else if (arg.startsWith('--val='))
      validationShare = Number.parseFloat(arg.slice('--val='.length));
  }
  if (
    Number.isNaN(seed) ||
    !Number.isFinite(validationShare) ||
    validationShare <= 0 ||
    validationShare >= 1
  ) {
    throw new Error('--seed must be an integer and --val a share strictly between 0 and 1');
  }
  return {
    datasetId,
    config: {
      seed,
      validationShare,
      iterations: DEFAULT_ITERATIONS,
      learningRate: DEFAULT_LEARNING_RATE,
      regularization: DEFAULT_REGULARIZATION,
    },
  };
}

/** Pick the target dataset id: the CLI argument, or the most recent dataset. */
async function resolveDatasetId(db: DrizzleDB, explicit: string | null): Promise<string> {
  if (explicit !== null) {
    return explicit;
  }
  const rows = await db
    .select({ id: calibrationDatasets.id })
    .from(calibrationDatasets)
    .orderBy(desc(calibrationDatasets.created_at))
    .limit(1);
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('no calibration dataset exists — run pnpm eval:make-dataset first');
  }
  return id;
}

/** Coerce the `factor_scores` jsonb into the extractor's typed shape. */
function toFactorScores(value: unknown): FactorScores {
  const record = value as Record<string, unknown>;
  const read = (key: string): number => {
    const entry = record[key];
    return typeof entry === 'number' ? entry : Number.NaN;
  };
  const scores: FactorScores = {
    risk: read('risk'),
    impact: read('impact'),
    novelty: read('novelty'),
    complexity: read('complexity'),
    confidence: read('confidence'),
  };
  for (const key of ['risk', 'impact', 'novelty', 'complexity', 'confidence'] as const) {
    if (Number.isNaN(scores[key])) {
      throw new Error(`malformed factor_scores: missing numeric "${key}"`);
    }
  }
  return scores;
}

interface CalibrationRowDatum {
  readonly factorScores: unknown;
  readonly outcome: string;
}

/** Load the fit samples for one dataset (row → feature vector + binary label). */
async function loadSamples(
  db: DrizzleDB,
  datasetId: string,
): Promise<{ samples: FitSample[]; labelSource: string }> {
  const [datasetRows, rowData] = await Promise.all([
    db
      .select({ labelSource: calibrationDatasets.label_source })
      .from(calibrationDatasets)
      .where(eq(calibrationDatasets.id, datasetId))
      .limit(1),
    db
      .select({ factorScores: calibrationRows.factor_scores, outcome: calibrationRows.outcome })
      .from(calibrationRows)
      .where(eq(calibrationRows.dataset_id, datasetId)),
  ]);
  const labelSource = datasetRows[0]?.labelSource;
  if (labelSource === undefined) {
    throw new Error(`no calibration dataset with id "${datasetId}"`);
  }
  const samples: FitSample[] = (rowData as CalibrationRowDatum[]).map((row) => ({
    features: toFeatureVector(toFactorScores(row.factorScores)),
    label: binaryLabel(row.outcome),
  }));
  return { samples, labelSource };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  const { datasetId, config } = parseArgs(process.argv.slice(2));
  const db = createDb(connectionString);

  try {
    const target = await resolveDatasetId(db, datasetId);
    const { samples, labelSource } = await loadSamples(db, target);
    if (samples.length === 0) {
      throw new Error(`dataset "${target}" has no rows to fit`);
    }

    const result = fitWeights(samples, config);
    const report = buildFitReport({ id: target, labelSource }, result, config);

    await db.insert(calibrationWeights).values({
      id: uuidv7(),
      dataset_id: target,
      method: FIT_METHOD,
      weights: result.fittedWeights,
      fit_config: {
        seed: config.seed,
        validationShare: config.validationShare,
        iterations: config.iterations,
        learningRate: config.learningRate,
        regularization: config.regularization,
      },
      log_loss_fitted: result.fitted.logLoss,
      log_loss_placeholder: result.placeholder.logLoss,
      ranking_accuracy_fitted: result.fitted.rankingAccuracy,
      ranking_accuracy_placeholder: result.placeholder.rankingAccuracy,
    });

    console.log(JSON.stringify(report, null, 2));
  } catch (error: unknown) {
    console.error(`[eval:fit] ${String(error)}`);
    process.exitCode = 1;
  } finally {
    await (db as unknown as ClosableDb).$client.end();
  }
}

void main();
