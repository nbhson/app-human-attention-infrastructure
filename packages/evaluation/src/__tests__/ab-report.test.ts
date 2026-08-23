/**
 * Integration tests for the Day-29 A/B dry-run (day-29 §3.4, §5, §6).
 *
 * Mirrors `ab-harness.test.ts`: a fresh isolated schema, a real {@link RankingDryRun}
 * over the canonical + multi-file trajectory fixtures, and the three day-29
 * acceptance assertions — (1) the guardrail holds (live `tasks`/`decisions`/
 * `contexts` rows do not move, so arm B's `hybrid` ranking never reaches a served
 * `ContextSnapshot`), (2) the comparison is computable and answered *honestly* —
 * over this three-fixture replay corpus the hybrid arm reproduces the keyword
 * order exactly, so the harness returns `keep-shadow` (insufficient evidence)
 * rather than over-claiming a WIN — and (3) the stored `ab_runs.report`
 * round-trips via `loadStoredResult` (the `--run <id>` read-back path).
 */

import { fileURLToPath } from 'node:url';

import { count } from 'drizzle-orm';

import { AbStore, asReadonlyDb, contexts, decisions, tasks } from '@harness/db';
import { createTestDb, destroyTestDb } from '@harness/db/test-utils';
import type { TestDb } from '@harness/db/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { loadStoredResult, RankingDryRun } from '../ab/ab-report.js';
import { loadTrajectory } from '../replay/loader.js';
import type { ReplayInput } from '../trajectory-replayer.js';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../../../fixtures/trajectories/${name}`, import.meta.url));
}

async function loadAllFixtures(): Promise<ReplayInput[]> {
  const names = ['coding-run.json', 'auth-gateway-token-refresh.json', 'search-index-ranking.json'];
  const inputs: ReplayInput[] = [];
  for (const name of names) {
    const loaded = await loadTrajectory(fixturePath(name));
    inputs.push({
      runId: loaded.runId,
      trajectory: loaded.trajectory,
      ...(loaded.recordedHash !== undefined ? { expectedSourceHash: loaded.recordedHash } : {}),
    });
  }
  return inputs;
}

describe('RankingDryRun (integration)', () => {
  const SCHEMA = 'ab_report_test';
  let testDb: TestDb | undefined;

  afterEach(async () => {
    if (testDb) {
      await destroyTestDb(testDb, SCHEMA);
      testDb = undefined;
    }
  });

  it('records both arms, holds the guardrail, answers HOLD honestly, and round-trips via --run', async () => {
    testDb = await createTestDb(SCHEMA);
    const db = testDb.db;

    const harness = new RankingDryRun(asReadonlyDb(db), new AbStore(db));
    const result = await harness.run({ fixtures: await loadAllFixtures() });

    expect(result.numInputs).toBe(3);
    expect(result.noProductionEffect).toBe(true);
    expect(result.arms.A.rankMethod).toBe('keyword');
    expect(result.arms.B.rankMethod).toBe('hybrid');

    // The comparison is computable (at least one input shares ≥2 top-k items)…
    expect(result.rankCorrelation.count).toBeGreaterThan(0);

    // …but the honest verdict is HOLD: over this three-fixture corpus the hybrid
    // arm reproduces the keyword order (tau = 1.0 on every computable input), so
    // the evidence is insufficient and the harness refuses to over-claim a WIN.
    // Hybrid earns the default only on a live, outcome-measuring A/B (day-29 §6).
    expect(result.evidence.verdict).toBe('insufficient');
    expect(result.recommendation).toBe('keep-shadow');

    // Arm B's ranking never reached a served ContextSnapshot: the live
    // `contexts` table is untouched (and empty in this fresh schema).
    const taskCount = (await db.select({ n: count() }).from(tasks))[0]?.n;
    const decisionCount = (await db.select({ n: count() }).from(decisions))[0]?.n;
    const contextCount = (await db.select({ n: count() }).from(contexts))[0]?.n;
    expect(taskCount).toBe(0);
    expect(decisionCount).toBe(0);
    expect(contextCount).toBe(0);

    // The stored jsonb report reproduces the same result on read-back.
    const reloaded = await loadStoredResult(asReadonlyDb(db), result.experimentId);
    expect(reloaded.noProductionEffect).toBe(true);
    expect(reloaded.arms.B.rankMethod).toBe('hybrid');
    expect(reloaded.rankCorrelation.values).toEqual(result.rankCorrelation.values);
  });
});
