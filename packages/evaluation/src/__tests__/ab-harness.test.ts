/**
 * Tests for the A/B shadow harness (day-09 §3.5, §5).
 *
 * Three layers: the pure comparator (winner/go/delta), the pure shadow ranker
 * (weight-dependence + corpus derivation), and the DB-backed integration run that
 * proves the zero-production-effect invariant (live rows unchanged, only
 * `ab_experiments`/`ab_runs` written) and the "beat the incumbent" gate.
 */

import { fileURLToPath } from 'node:url';

import { count, eq } from 'drizzle-orm';

import { abExperiments, abRuns, AbStore, asReadonlyDb, decisions, projects, tasks } from '@harness/db';
import { createTestDb, destroyTestDb } from '@harness/db/test-utils';
import type { TestDb } from '@harness/db/test-utils';
import { brand, type AgentRun, type TrajectoryStep } from '@harness/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { AbHarness } from '../harness/ab-harness.js';
import { compare } from '../harness/compare.js';
import { dependencyProximity, deriveCorpus, runRankMetric } from '../harness/variant.js';
import type { PipelineVariant, RankCorpus } from '../harness/variant.js';
import { loadTrajectory } from '../replay/loader.js';
import type { ReplayInput } from '../trajectory-replayer.js';

const FIXTURE = fileURLToPath(new URL('../../../../fixtures/trajectories/coding-run.json', import.meta.url));

const baseline: PipelineVariant = {
  variantId: 'baseline-keyword',
  description: 'Phase-1 keyword ranker (0.7 keyword / 0.3 dependency)',
  contextRanker: 'keyword',
  rankWeights: { keywordOverlap: 0.7, dependencyProximity: 0.3 },
};

const depHeavy: PipelineVariant = {
  variantId: 'dep-heavy-shadow',
  description: 'dependency-heavier tuple (0.3 keyword / 0.7 dependency)',
  contextRanker: 'keyword',
  rankWeights: { keywordOverlap: 0.3, dependencyProximity: 0.7 },
};

const keywordHeavier: PipelineVariant = {
  variantId: 'kw-heavier-shadow',
  description: 'keyword-heavier tuple (0.9 keyword / 0.1 dependency)',
  contextRanker: 'keyword',
  rankWeights: { keywordOverlap: 0.9, dependencyProximity: 0.1 },
};

async function loadFixtureInputs(): Promise<ReplayInput[]> {
  const loaded = await loadTrajectory(FIXTURE);
  return [
    {
      runId: loaded.runId,
      trajectory: loaded.trajectory,
      ...(loaded.recordedHash !== undefined ? { expectedSourceHash: loaded.recordedHash } : {}),
    },
  ];
}

describe('compare', () => {
  it('emits go:true and winner B when B beats A', () => {
    const outcome = compare({
      experimentId: 'e1',
      metric: 'mean_target_relevance',
      aValue: 0.5,
      bValue: 0.8,
      noProductionEffect: true,
    });
    expect(outcome.winner).toBe('B');
    expect(outcome.go).toBe(true);
    expect(outcome.delta).toBeCloseTo(0.3);
  });

  it('emits go:false, winner A, and a negative delta when B loses', () => {
    const outcome = compare({
      experimentId: 'e1',
      metric: 'mean_target_relevance',
      aValue: 0.9,
      bValue: 0.6,
      noProductionEffect: true,
    });
    expect(outcome.winner).toBe('A');
    expect(outcome.go).toBe(false);
    expect(outcome.delta).toBeCloseTo(-0.3);
  });

  it('emits TIE and go:false on equal values', () => {
    const outcome = compare({
      experimentId: 'e1',
      metric: 'mean_target_relevance',
      aValue: 0.5,
      bValue: 0.5,
      noProductionEffect: true,
    });
    expect(outcome.winner).toBe('TIE');
    expect(outcome.go).toBe(false);
    expect(outcome.delta).toBe(0);
  });
});

describe('runRankMetric (shadow ranker)', () => {
  // A single target with zero keyword overlap: dependency = 1.0, keyword = 0.
  // This makes the weight tuple's effect exact and deterministic.
  const corpus: RankCorpus = {
    taskKeywords: ['a_keyword_not_in_the_source'],
    targetFiles: ['src/a.ts'],
    candidateFiles: [{ sourceId: 'src/a.ts', content: 'export const ok = true;' }],
  };

  it('is deterministic', () => {
    expect(runRankMetric(baseline, corpus)).toBe(runRankMetric(baseline, corpus));
  });

  it('scores a high-dependency target higher under dependency-heavy weights', () => {
    const keyword = runRankMetric(baseline, corpus); // (0.7 * 0) + (0.3 * 1) = 0.3
    const dependency = runRankMetric(depHeavy, corpus); // (0.3 * 0) + (0.7 * 1) = 0.7
    expect(keyword).toBeCloseTo(0.3);
    expect(dependency).toBeCloseTo(0.7);
    expect(dependency).toBeGreaterThan(keyword);
  });

  it('dependencyProximity assigns 1.0 / 0.6 / 0.1 by target centrality', () => {
    const targets = ['src/a.ts'];
    expect(dependencyProximity('src/a.ts', targets)).toBe(1.0);
    expect(dependencyProximity('src/b.ts', targets)).toBe(0.6);
    expect(dependencyProximity('test/c.ts', targets)).toBe(0.1);
  });
});

describe('deriveCorpus', () => {
  it('derives targets from artifactsChanged and candidates from tool calls', () => {
    const trajectory = makeTrajectory();
    const corpus = deriveCorpus(trajectory);

    expect(corpus.targetFiles).toEqual(['src/a.ts']);
    expect(corpus.candidateFiles.map((file) => file.sourceId)).toEqual(['src/a.ts']);
    expect(corpus.candidateFiles[0]?.content).toContain('isValidEmail');
    expect(corpus.taskKeywords.length).toBeGreaterThan(0);
  });
});

describe('AbHarness (integration)', () => {
  const SCHEMA = 'ab_harness_test';
  let testDb: TestDb | undefined;

  afterEach(async () => {
    if (testDb) {
      await destroyTestDb(testDb, SCHEMA);
      testDb = undefined;
    }
  });

  it('writes an experiment + two runs, B beats A, and live rows are unchanged', async () => {
    testDb = await createTestDb(SCHEMA);
    const db = testDb.db;

    // Seed one live task so "unchanged" is a non-trivial assertion (1 -> 1).
    await db.insert(projects).values({ id: 'project-1', name: 'p', repo_path: '/tmp/p' });
    await db.insert(tasks).values({
      id: 'task-1',
      project_id: 'project-1',
      title: 't',
      idempotency_key: 'k1',
    });

    const harness = new AbHarness(asReadonlyDb(db), new AbStore(db));
    const outcome = await harness.run({
      name: 'demo',
      variantA: baseline,
      variantB: depHeavy,
      metric: 'mean_target_relevance',
      inputs: await loadFixtureInputs(),
    });

    expect(outcome.winner).toBe('B');
    expect(outcome.go).toBe(true);
    expect(outcome.delta).toBeGreaterThan(0);
    expect(outcome.noProductionEffect).toBe(true);
    expect(outcome.metric).toBe('mean_target_relevance');

    const experiments = await db.select().from(abExperiments);
    expect(experiments).toHaveLength(1);
    const experiment = experiments[0]!;
    expect(experiment.metric).toBe('mean_target_relevance');
    expect(outcome.experimentId).toBe(experiment.id);

    const runs = await db.select().from(abRuns).where(eq(abRuns.experiment_id, experiment.id));
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.variant_id).sort()).toEqual(['A', 'B']);

    // Zero-production-effect: the seeded task is still the only live row.
    const taskCount = (await db.select({ n: count() }).from(tasks))[0]?.n;
    const decisionCount = (await db.select({ n: count() }).from(decisions))[0]?.n;
    expect(taskCount).toBe(1);
    expect(decisionCount).toBe(0);
  });

  it('emits go:false when the variant does not beat the incumbent', async () => {
    testDb = await createTestDb(SCHEMA);
    const db = testDb.db;

    const harness = new AbHarness(asReadonlyDb(db), new AbStore(db));
    const outcome = await harness.run({
      name: 'losing-demo',
      variantA: baseline,
      variantB: keywordHeavier, // (0.9 keyword / 0.1 dep) scores a high-dependency target lower
      metric: 'mean_target_relevance',
      inputs: await loadFixtureInputs(),
    });

    expect(outcome.winner).toBe('A');
    expect(outcome.go).toBe(false);
    expect(outcome.delta).toBeLessThan(0);
    expect(outcome.noProductionEffect).toBe(true);
  });
});

// --- In-memory trajectory fixture for deriveCorpus -------------------------

function makeTrajectory(): AgentRun {
  return {
    id: brand('run-x', 'AgentRunID'),
    taskId: brand('task-x', 'TaskID'),
    agentType: 'CODING_AGENT',
    modelUsed: 'claude-sonnet-4-6',
    status: 'COMPLETED',
    startTimestamp: new Date('2026-08-19T00:00:00.000Z'),
    endTimestamp: new Date('2026-08-19T00:00:14.000Z'),
    totalTokensUsed: 300,
    steps: [
      {
        type: 'THOUGHT',
        stepIndex: 0,
        timestamp: new Date('2026-08-19T00:00:00.000Z'),
        content: 'Add email validation to src/a.ts',
      },
      {
        type: 'TOOL_CALL',
        stepIndex: 1,
        timestamp: new Date('2026-08-19T00:00:03.000Z'),
        toolName: 'write_file',
        toolInput: {
          path: 'src/a.ts',
          content: 'export function isValidEmail(v: string): boolean { return true; }',
        },
        toolOutput: 'wrote src/a.ts',
      },
    ] satisfies TrajectoryStep[],
    finalOutput: 'done',
    artifactsChanged: ['src/a.ts'],
  };
}
