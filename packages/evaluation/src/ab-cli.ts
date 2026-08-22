/**
 * `pnpm eval:ab --fixture <path>` (day-10 §3.2, §5).
 *
 * Runs the Day-09 demo A/B pair — baseline keyword (0.7/0.3) vs dependency-heavy
 * (0.3/0.7) — over a replayed trajectory through {@link AbHarness}, writes the
 * `ab_experiments`/`ab_runs` rows to the *isolated* shadow store, and prints the
 * go/no-go outcome as JSON. A replay-divergence fixture exits non-zero before any
 * row is written (§6 of the Day-09 plan).
 */

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { config } from 'dotenv';

import { AbStore, asReadonlyDb, createDb } from '@harness/db';

import { AbHarness } from './harness/ab-harness.js';
import type { PipelineVariant } from './harness/variant.js';
import { loadTrajectory } from './replay/loader.js';
import type { ReplayInput } from './trajectory-replayer.js';

for (const candidate of ['.env', '../../.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    config({ path });
    break;
  }
}

/** The postgres.js handle `createDb` wraps; `DrizzleDB` drops it, so `--once` type
 * tests reach it the way `report-cli.ts` does. */
type ClosableDb = { $client: { end: () => Promise<unknown> } };

const DEFAULT_FIXTURE = 'fixtures/trajectories/coding-run.json';

const BASELINE: PipelineVariant = {
  variantId: 'baseline-keyword',
  description: 'Phase-1 keyword ranker (0.7 keyword / 0.3 dependency)',
  contextRanker: 'keyword',
  rankWeights: { keywordOverlap: 0.7, dependencyProximity: 0.3 },
};

const DEP_HEAVY: PipelineVariant = {
  variantId: 'dep-heavy-shadow',
  description: 'dependency-heavier tuple (0.3 keyword / 0.7 dependency)',
  contextRanker: 'keyword',
  rankWeights: { keywordOverlap: 0.3, dependencyProximity: 0.7 },
};

function parseFixturePath(argv: readonly string[]): string {
  for (const arg of argv) {
    if (arg.startsWith('--fixture=')) return arg.slice('--fixture='.length);
  }
  return DEFAULT_FIXTURE;
}

/** Root `pnpm eval:ab` forwards to a `tsx` subprocess cwd'd at `packages/evaluation`;
 * resolve repo-root-relative paths against `INIT_CWD` like `replay-cli.ts`. */
function resolveFixturePath(path: string): string {
  if (isAbsolute(path)) return path;
  const base = process.env.INIT_CWD ?? process.cwd();
  return resolve(base, path);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  const db = createDb(connectionString);
  try {
    const loaded = await loadTrajectory(
      resolveFixturePath(parseFixturePath(process.argv.slice(2))),
    );
    const inputs: ReplayInput[] = [
      {
        runId: loaded.runId,
        trajectory: loaded.trajectory,
        ...(loaded.recordedHash !== undefined ? { expectedSourceHash: loaded.recordedHash } : {}),
      },
    ];

    const harness = new AbHarness(asReadonlyDb(db), new AbStore(db));
    const outcome = await harness.run({
      name: 'day-10-demo',
      variantA: BASELINE,
      variantB: DEP_HEAVY,
      metric: 'mean_target_relevance',
      inputs,
    });
    console.log(JSON.stringify(outcome, null, 2));
  } catch (error: unknown) {
    console.error(`[eval:ab] ${String(error)}`);
    process.exitCode = 1;
  } finally {
    await (db as unknown as ClosableDb).$client.end();
  }
}

void main();
