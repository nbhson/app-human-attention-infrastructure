/**
 * `pnpm eval:report --once --from <iso> --to <iso>` (day-07 §3.3, §5).
 *
 * The report entrypoint: computes the Day-06 metrics for a window, compares them
 * to the prior window's persisted lines, and appends the flat report to the
 * `evaluation_reports` history. `--schedule` replaces `--from/--to` with a
 * rolling window driven by `EVAL_REPORT_SCHEDULE` (default Monday 06:00).
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';

import { createDb } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import { loadMetricsInput } from './loader.js';
import { MetricsComputer } from './metrics-computer.js';
import type { EvaluationReport } from './report.js';
import { ReportGenerator } from './report-generator.js';
import { ReportStore } from './report-store.js';
import { nodeCron, ReportScheduler } from './scheduler.js';

/** The postgres.js handle `createDb` wraps; `drizzle` exposes it but the public
 * `DrizzleDB` alias drops it, so the `--once` path reaches it with this cast. */
type ClosableDb = { $client: { end: () => Promise<unknown> } };

const DEFAULT_SCHEDULE = '0 6 * * 1'; // Monday 06:00
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_SOURCE_VERSION = 'v0.2.0-harness';

for (const candidate of ['.env', '../../.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    config({ path });
    break;
  }
}

interface CliArgs {
  readonly from?: string;
  readonly to?: string;
  readonly schedule: boolean;
  readonly once: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let from: string | undefined;
  let to: string | undefined;
  let schedule = false;
  let once = false;
  for (const arg of argv) {
    if (arg.startsWith('--from=')) from = arg.slice('--from='.length);
    else if (arg.startsWith('--to=')) to = arg.slice('--to='.length);
    else if (arg === '--schedule') schedule = true;
    else if (arg === '--once') once = true;
  }
  return {
    schedule,
    once,
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

function sourceVersion(): string {
  return process.env.SOURCE_VERSION ?? process.env.EVAL_SOURCE_VERSION ?? DEFAULT_SOURCE_VERSION;
}

/** Compute the current window's metrics, diff against the prior window, persist. */
async function buildAndPersist(
  db: DrizzleDB,
  store: ReportStore,
  generator: ReportGenerator,
  from: Date,
  to: Date,
  version: string,
): Promise<EvaluationReport> {
  const current = new MetricsComputer().compute(await loadMetricsInput(db, { from, to }));
  const windowLengthMs = to.getTime() - from.getTime();
  const priorReports = await store.listByWindow(new Date(from.getTime() - windowLengthMs), from);
  const previousLines = priorReports.at(-1)?.report.lines;
  const report = generator.generate(current, previousLines);
  await store.insert(report, version);
  return report;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  const db = createDb(connectionString);
  const store = new ReportStore(db);
  const generator = new ReportGenerator();
  const version = sourceVersion();

  if (args.schedule || (!args.from && !args.to && !args.once)) {
    // Rolling windows against a fixed default length; a missed tick is backfilled
    // via `--from/--to`, never a durable-queue concern (day-07 §2.4).
    const expression = process.env.EVAL_REPORT_SCHEDULE ?? DEFAULT_SCHEDULE;
    const windowDays = Number(process.env.EVAL_REPORT_WINDOW_DAYS ?? DEFAULT_WINDOW_DAYS);
    const windowMs = windowDays * 24 * 60 * 60 * 1000;

    const tick = async (): Promise<void> => {
      try {
        const to = new Date();
        const from = new Date(to.getTime() - windowMs);
        const report = await buildAndPersist(db, store, generator, from, to, version);
        console.log(JSON.stringify(report, null, 2));
      } catch (error: unknown) {
        console.error(`[eval:report] scheduled tick failed: ${String(error)}`);
      }
    };

    const scheduler = new ReportScheduler(nodeCron, expression, tick);
    scheduler.start();
    console.error(`[eval:report] scheduled "${expression}" — press Ctrl+C to stop`);
    return; // the cron handle keeps the process alive
  }

  const { from, to } = args;
  if (!from || !to) {
    console.error('usage: pnpm eval:report --once --from=<ISO> --to=<ISO>');
    process.exitCode = 1;
    return;
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    console.error('--from/--to must be valid ISO-8601 dates.');
    process.exitCode = 1;
    return;
  }

  try {
    const report = await buildAndPersist(db, store, generator, fromDate, toDate, version);
    console.log(JSON.stringify(report, null, 2));
  } catch (error: unknown) {
    console.error(`[eval:report] ${String(error)}`);
    process.exitCode = 1;
  } finally {
    // `--once` must drain the pool so the process exits; `--schedule` returns
    // above and deliberately keeps the connection (and the cron) alive.
    await (db as unknown as ClosableDb).$client.end();
  }
}

void main();
