/**
 * Tests for the Day-29 context-rankers behind the shared seam (day-29 §2.1, §5).
 *
 * Pure-function coverage only: corpus derivation, determinism, target
 * preservation (a ranker may never drop a target file), and the one deliberate
 * divergence the harness is built to detect — keyword (path-centrality) vs
 * semantic (content-cosine) reorder the same corpus.
 */

import { brand, type AgentRun, type TrajectoryStep } from '@harness/domain';
import { describe, expect, it } from 'vitest';

import {
  deriveRankingCorpus,
  keywordRanker,
  rankingVariants,
  semanticRanker,
} from '../ab/ranking-variants.js';
import type { RankingCorpus } from '../ab/ranking-variants.js';

describe('rankingVariants', () => {
  it('exposes keyword (A) then semantic (B) behind the seam', () => {
    expect(rankingVariants().map((ranker) => ranker.kind)).toEqual(['keyword', 'semantic']);
  });

  it('both rankers are deterministic for the same corpus', () => {
    const corpus = reorderCorpus();
    expect(keywordRanker.rank(corpus)).toEqual(keywordRanker.rank(corpus));
    expect(semanticRanker.rank(corpus)).toEqual(semanticRanker.rank(corpus));
  });

  it('keyword and semantic reorder the same corpus (path-centrality vs content)', () => {
    const corpus = reorderCorpus();
    const keyword = keywordRanker.rank(corpus).map((source) => source.sourceId);
    const semantic = semanticRanker.rank(corpus).map((source) => source.sourceId);

    // Keyword surfaces the target (dependency = 1.0) even though its content
    // barely matches the query; semantic surfaces the content-rich helper.
    expect(keyword).toEqual(['src/gateway.ts', 'src/auth/refresh.ts']);
    expect(semantic).toEqual(['src/auth/refresh.ts', 'src/gateway.ts']);
    expect(keyword).not.toEqual(semantic);
  });

  it('never drops a target file, even with no ranking signal', () => {
    const corpus: RankingCorpus = {
      query: 'nothing that matches any candidate',
      targetFiles: ['src/missing.ts'],
      candidateFiles: [{ sourceId: 'src/present.ts', content: 'present token' }],
    };
    const ranked = semanticRanker.rank(corpus).map((source) => source.sourceId);
    expect(ranked).toContain('src/missing.ts');
    // With no signal the target sorts to the bottom (NO_SIGNAL = -1).
    expect(ranked[ranked.length - 1]).toBe('src/missing.ts');
  });
});

describe('deriveRankingCorpus', () => {
  it('derives targets from artifactsChanged, candidates from tool calls, query from thoughts', () => {
    const corpus = deriveRankingCorpus(makeTrajectory());
    expect(corpus.targetFiles).toEqual(['src/a.ts']);
    expect(corpus.candidateFiles.map((file) => file.sourceId)).toEqual(['src/a.ts']);
    expect(corpus.query).toContain('email');
  });
});

/** A corpus whose two arms provably reorder (see ranking-variants docstring). */
function reorderCorpus(): RankingCorpus {
  return {
    query: 'auth gateway token refresh',
    targetFiles: ['src/gateway.ts'],
    candidateFiles: [
      { sourceId: 'src/gateway.ts', content: 'export default gateway;' },
      {
        sourceId: 'src/auth/refresh.ts',
        content:
          'auth refresh module with several extra helper tokens for padding the vector length considerably',
      },
    ],
  };
}

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
