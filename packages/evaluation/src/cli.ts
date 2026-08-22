/**
 * `pnpm eval:metrics --from <iso> --to <iso>` (day-06 §3.5).
 *
 * Runs the offline metric computation over a real window and prints the JSON
 * report. Reads `DATABASE_URL` (via `.env`) and connects to the store directly —
 * never through the live pipeline.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';

import { createDb } from '@harness/db';

import { loadMetricsInput } from './loader.js';
import { applyGauges, MetricsComputer } from './metrics-computer.js';

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
}

function parseArgs(argv: readonly string[]): CliArgs {
  let from: string | undefined;
  let to: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--from=')) from = arg.slice('--from='.length);
    else if (arg.startsWith('--to=')) to = arg.slice('--to='.length);
  }
  return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
}

async function main(): Promise<void> {
  const { from, to } = parseArgs(process.argv.slice(2));
  if (!from || !to) {
    console.error('usage: pnpm eval:metrics --from=<ISO> --to=<ISO>');
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.');
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

  const db = createDb(connectionString);
  const input = await loadMetricsInput(db, { from: fromDate, to: toDate });
  const report = new MetricsComputer().compute(input);
  applyGauges(report);
  console.log(JSON.stringify(report, null, 2));
}

void main();
