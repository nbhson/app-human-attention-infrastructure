import { describe, expect, it } from 'vitest';

import type { PullRequestFile } from '@harness/domain';
import { PullRequestFileStatus } from '@harness/domain';

import { MockLLM, mockTextResponse } from '../llm/mock-llm.js';
import { ReviewAgent } from '../review/review-agent.js';
import { batchReview } from '../review/review-batch.js';
import { buildImpactScope, buildImpactScopeSection, filterImpactScopeForBatch } from '../review/review-impact.js';
import { buildReviewPrompt, REVIEW_PROMPT_VERSION } from '../review/review-prompt.js';

function prFile(path: string, patch: string): PullRequestFile {
  return { path, status: PullRequestFileStatus.Modified, additions: 1, deletions: 1, patch };
}

const REVIEW_JSON = JSON.stringify({
  summary: 'ok',
  overallVerdict: 'APPROVE',
  findings: [],
  suggestions: [],
  healthScore: {
    architecture: 'good',
    codeQuality: 'good',
    security: 'good',
    performance: 'good',
    testing: 'good',
    overallRisk: 'LOW',
    architectureScore: 75,
    codeQualityScore: 75,
    securityScore: 75,
    performanceScore: 75,
    testingScore: 75,
    overallRiskScore: 20,
  },
});

describe('buildImpactScope', () => {
  it('links an in-PR importer to the shared file it imports', () => {
    const scope = buildImpactScope([
      prFile('src/shared/format.ts', '@@ -1 +1 @@\n+export function format(v: string) { return v; }\n'),
      prFile('src/pages/ReportPage.tsx', "@@ -1 +1 @@\n+import { format } from '../shared/format';\n"),
    ]);

    const shared = scope.find((e) => e.file === 'src/shared/format.ts');
    expect(shared?.importedBy).toEqual(['src/pages/ReportPage.tsx']);
    const page = scope.find((e) => e.file === 'src/pages/ReportPage.tsx');
    expect(page?.imports).toEqual(['src/shared/format.ts']);
  });

  it('returns empty edges when changed files do not import each other', () => {
    const scope = buildImpactScope([
      prFile('src/a.ts', '@@ -1 +1 @@\n+export const a = 1;\n'),
      prFile('src/b.ts', '@@ -1 +1 @@\n+export const b = 2;\n'),
    ]);
    expect(scope).toHaveLength(2);
    expect(scope.every((e) => e.importedBy.length === 0 && e.imports.length === 0)).toBe(true);
  });

  it('ignores dynamic imports that cannot be resolved statically', () => {
    const scope = buildImpactScope([
      prFile('src/shared/format.ts', '@@ -1 +1 @@\n+export function format(v: string) { return v; }\n'),
      prFile('src/pages/Lazy.tsx', '@@ -1 +1 @@\n+const m = await import(variableName);\n'),
    ]);
    expect(scope.every((e) => e.importedBy.length === 0 && e.imports.length === 0)).toBe(true);
  });
});

describe('buildImpactScopeSection', () => {
  it('names visible callers and warns that external callers are unknown', () => {
    const section = buildImpactScopeSection([
      { file: 'src/shared/format.ts', importedBy: ['src/pages/ReportPage.tsx'], imports: [] },
    ]);
    expect(section).toContain('IMPACT SCOPE');
    expect(section).toContain('src/shared/format.ts');
    expect(section).toContain('src/pages/ReportPage.tsx');
    expect(section).toContain('outside this PR');
  });

  it('renders the no-edges fallback instead of an empty section', () => {
    const section = buildImpactScopeSection([]);
    expect(section).toContain('IMPACT SCOPE');
    expect(section).toContain('potentially used outside this diff');
  });
});

describe('filterImpactScopeForBatch', () => {
  it('keeps only entries touching the batch files', () => {
    const scope = [
      { file: 'src/shared/format.ts', importedBy: ['src/pages/A.tsx'], imports: [] },
      { file: 'src/other/util.ts', importedBy: [], imports: [] },
    ];
    const filtered = filterImpactScopeForBatch(scope, ['src/pages/A.tsx']);
    expect(filtered.map((e) => e.file)).toEqual(['src/shared/format.ts']);
  });
});

describe('impact scope prompt wiring (reviewer-v9)', () => {
  it('bumps the prompt version and requires impact enumeration in the workflow', () => {
    expect(REVIEW_PROMPT_VERSION).toBe('reviewer-v9');
  });

  it('renders IMPACT SCOPE between instructions and the fenced diff', async () => {
    const llm = new MockLLM([mockTextResponse(REVIEW_JSON)]);
    const agent = new ReviewAgent(llm);

    await agent.review(
      {
        prUrl: 'https://example.com/pr/1',
        prTitle: 'shared change',
        requirement: 'req',
        diff: '--- a/src/shared/format.ts\n+++ b/src/shared/format.ts\n',
        impactScope: [{ file: 'src/shared/format.ts', importedBy: ['src/pages/A.tsx'], imports: [] }],
      },
      { model: 'm' },
    );

    const user = llm.calls[0]?.messages[0]?.content ?? '';
    const impactAt = user.indexOf('IMPACT SCOPE');
    const fenceAt = user.indexOf('=== BEGIN DIFF');
    expect(impactAt).toBeGreaterThanOrEqual(0);
    expect(impactAt).toBeLessThan(fenceAt);
    expect(user).toContain('src/pages/A.tsx');

    const sys = llm.calls[0]?.systemPrompt ?? '';
    expect(sys).toContain('IMPACT SCOPE');
  });

  it('buildReviewPrompt always includes the section (even with no edges)', () => {
    const { userMessage } = buildReviewPrompt({
      prUrl: 'https://example.com/pr/1',
      prTitle: 't',
      requirement: 'r',
      diff: 'diff',
    });
    expect(userMessage).toContain('IMPACT SCOPE');
  });

  it('forwards impact scope to every batch (filtered per batch)', async () => {
    const llm = new MockLLM([mockTextResponse(REVIEW_JSON), mockTextResponse(REVIEW_JSON)]);
    const agent = new ReviewAgent(llm);
    const files = [
      prFile('src/shared/format.ts', '@@ -1 +1 @@\n+export function format(v: string) { return v; }\n'),
      prFile('src/pages/A.tsx', "@@ -1 +1 @@\n+import { format } from '../shared/format';\n"),
      prFile('src/pages/B.tsx', "@@ -1 +1 @@\n+import { format } from '../shared/format';\n"),
      prFile('src/pages/C.tsx', "@@ -1 +1 @@\n+import { format } from '../shared/format';\n"),
      prFile('src/pages/D.tsx', "@@ -1 +1 @@\n+import { format } from '../shared/format';\n"),
      prFile('src/pages/E.tsx', "@@ -1 +1 @@\n+import { format } from '../shared/format';\n"),
    ];
    const scope = buildImpactScope(files);
    expect(scope.length).toBeGreaterThan(0);

    await batchReview(agent, files, {
      prUrl: 'https://example.com/pr/1',
      prTitle: 't',
      requirement: 'r',
      model: 'm',
      correlationId: 'c',
      maxBatchSize: 2,
      impactScope: scope,
    });

    expect(llm.calls.length).toBeGreaterThan(1);
    for (const call of llm.calls) {
      expect(call.messages[0]?.content).toContain('IMPACT SCOPE');
    }
  });
});
