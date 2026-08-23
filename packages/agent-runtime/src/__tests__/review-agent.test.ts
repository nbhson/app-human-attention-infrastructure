import { describe, expect, it } from 'vitest';

import { MockLLM, mockTextResponse } from '../llm/mock-llm.js';
import { ReviewAgent } from '../review/review-agent.js';

const INPUT = {
  prUrl: 'https://github.com/acme/app/pull/7',
  prTitle: 'Fix retry loop',
  requirement: 'The retry loop must not spin forever.',
  diff: '--- a/src/loop.ts\n+++ b/src/loop.ts\n',
};

const REVIEW_JSON = JSON.stringify({
  summary: 'Correct fix, one nit.',
  overallVerdict: 'REQUEST_CHANGES',
  findings: [{ severity: 'NIT', file: 'src/loop.ts', line: 3, message: 'naming' }],
  suggestions: [],
});

describe('ReviewAgent', () => {
  it('builds the reviewer prompt, calls the LLM, and parses the review', async () => {
    const llm = new MockLLM([mockTextResponse(REVIEW_JSON)]);
    const agent = new ReviewAgent(llm);

    const out = await agent.review(INPUT, { model: 'claude-sonnet-4-6' });

    expect(out.summary).toBe('Correct fix, one nit.');
    expect(out.overallVerdict).toBe('REQUEST_CHANGES');
    expect(out.findings).toHaveLength(1);

    const call = llm.calls[0];
    expect(call?.model).toBe('claude-sonnet-4-6');
    expect(call?.systemPrompt).toContain('senior code reviewer');
    expect(call?.messages[0]?.content).toContain('https://github.com/acme/app/pull/7');
    expect(call?.messages[0]?.content).toContain('The retry loop must not spin forever.');
    expect(call?.messages[0]?.content).toContain('--- a/src/loop.ts');
  });

  it('forwards correlation_id to the LLM for provenance', async () => {
    const llm = new MockLLM([
      mockTextResponse('{"summary":"","overallVerdict":"APPROVE","findings":[],"suggestions":[]}'),
    ]);
    const agent = new ReviewAgent(llm);

    await agent.review(INPUT, { model: 'm', correlationId: 'corr-42' });

    expect(llm.calls[0]?.correlation_id).toBe('corr-42');
  });
});
