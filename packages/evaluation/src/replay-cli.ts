/**
 * `pnpm eval:replay --fixture <path>` (day-08 §3.3, §4).
 *
 * Replays a recorded trajectory fixture through {@link TrajectoryReplayer} and
 * prints the fidelity result as JSON. Pure and offline — no live LLM, no live
 * tool call, no database. The `sourceHash` recorded in the fixture is verified
 * before any step is re-materialised; a tampered or non-contiguous stream exits
 * non-zero with the divergence detail on stderr.
 */

import { isAbsolute, resolve } from 'node:path';

import { loadTrajectory } from './replay/loader.js';
import { TrajectoryReplayer } from './trajectory-replayer.js';

function parseFixturePath(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith('--fixture=')) return arg.slice('--fixture='.length);
  }
  return undefined;
}

/**
 * Root `pnpm eval:replay --fixture=fixtures/...` forwards to a `tsx` subprocess
 * whose cwd is `packages/evaluation`, so a repo-root-relative path would miss.
 * pnpm leaves the caller's cwd in `INIT_CWD`; resolve against that when present.
 */
function resolveFixturePath(path: string): string {
  if (isAbsolute(path)) return path;
  const base = process.env.INIT_CWD ?? process.cwd();
  return resolve(base, path);
}

async function main(): Promise<void> {
  const fixture = parseFixturePath(process.argv.slice(2));
  if (!fixture) {
    console.error('usage: pnpm eval:replay --fixture=<path>');
    process.exitCode = 1;
    return;
  }

  try {
    const loaded = await loadTrajectory(resolveFixturePath(fixture));
    const result = new TrajectoryReplayer().replay({
      runId: loaded.runId,
      trajectory: loaded.trajectory,
      ...(loaded.recordedHash !== undefined ? { expectedSourceHash: loaded.recordedHash } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    console.error(`[eval:replay] ${String(error)}`);
    process.exitCode = 1;
  }
}

void main();
