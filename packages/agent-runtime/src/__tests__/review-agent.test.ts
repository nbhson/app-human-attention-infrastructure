import { describe, expect, it } from 'vitest';

import { MockLLM, mockTextResponse } from '../llm/mock-llm.js';
import { ReviewAgent } from '../review/review-agent.js';
import { REVIEW_PROMPT_VERSION } from '../review/review-prompt.js';

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

  it('injects operator instructions (text.md) into the review prompt when provided', async () => {
    const llm = new MockLLM([mockTextResponse(REVIEW_JSON)]);
    const agent = new ReviewAgent(llm);

    const out = await agent.review(
      { ...INPUT, instructions: 'Always flag any unhandled promise rejections.' },
      { model: 'claude-sonnet-4-6' },
    );

    expect(out.findings).toHaveLength(1);
    const content = llm.calls[0]?.messages[0]?.content;
    expect(content).toContain('OPERATOR INSTRUCTIONS (must be followed)');
    expect(content).toContain('Always flag any unhandled promise rejections.');
  });

  it('exposes a versioned prompt for provenance', () => {
    expect(REVIEW_PROMPT_VERSION).toMatch(/^reviewer-v\d+$/);
  });

  it('prompt includes the safety guardrail sections', async () => {
    const llm = new MockLLM([mockTextResponse(REVIEW_JSON)]);
    const agent = new ReviewAgent(llm);

    await agent.review(INPUT, { model: 'm' });

    const sys = llm.calls[0]?.systemPrompt ?? '';
    expect(sys).toContain('SAFETY GUARDRAIL');
    expect(sys).toContain('PROMPT INJECTION');
    expect(sys).toContain('EXPOSED SECRETS');
    expect(sys).toContain('SUSPECTED MALWARE');
    expect(sys).toContain('PII');
  });

  it('prompt includes the chain-of-thought instruction', async () => {
    const llm = new MockLLM([mockTextResponse(REVIEW_JSON)]);
    const agent = new ReviewAgent(llm);

    await agent.review(INPUT, { model: 'm' });

    expect(llm.calls[0]?.systemPrompt).toContain('CHAIN OF THOUGHT');
  });

  it('prompt includes few-shot examples', async () => {
    const llm = new MockLLM([mockTextResponse(REVIEW_JSON)]);
    const agent = new ReviewAgent(llm);

    await agent.review(INPUT, { model: 'm' });

    const sys = llm.calls[0]?.systemPrompt ?? '';
    expect(sys).toContain('Example 1 — CRITICAL security');
    expect(sys).toContain('Example 2 — MAJOR contract');
  });

  it('injects related memories into the user message when provided', async () => {
    const llm = new MockLLM([mockTextResponse(REVIEW_JSON)]);
    const agent = new ReviewAgent(llm);

    await agent.review(
      {
        ...INPUT,
        relatedMemories: [
          {
            kind: 'FINDING',
            content: 'past: null deref in retry.ts',
            confidence: 0.9,
            metadata: { severity: 'MAJOR' },
          },
        ],
      },
      { model: 'm' },
    );

    const user = llm.calls[0]?.messages[0]?.content ?? '';
    expect(user).toContain('RELATED PAST REVIEWS');
    expect(user).toContain('past: null deref in retry.ts');
    expect(user).toContain('severity=MAJOR');
  });

  it('falls back to (none provided) when requirement is empty', async () => {
    const llm = new MockLLM([
      mockTextResponse('{"summary":"x","overallVerdict":"APPROVE","findings":[],"suggestions":[]}'),
    ]);
    const agent = new ReviewAgent(llm);

    await agent.review({ ...INPUT, requirement: '' }, { model: 'm' });

    expect(llm.calls[0]?.messages[0]?.content).toContain('(none provided)');
  });

  it('forwards correlation_id to the LLM for provenance', async () => {
    const llm = new MockLLM([
      mockTextResponse('{"summary":"","overallVerdict":"APPROVE","findings":[],"suggestions":[]}'),
    ]);
    const agent = new ReviewAgent(llm);

    await agent.review(INPUT, { model: 'm', correlationId: 'corr-42' });

    expect(llm.calls[0]?.correlation_id).toBe('corr-42');
  });

  it('surfaces truncation when the provider stops at the token limit (OpenAI-compatible finish_reason="length")', async () => {
    // A fast/proxied model whose output budget was exhausted: partial or empty
    // content with stopReason "length" — the OpenAI-compatible mapping passes
    // finish_reason straight through, unlike Anthropic's "max_tokens".
    const llm = new MockLLM([
      { content: '', toolCalls: [], usage: { inputTokens: 810, outputTokens: 4096 }, stopReason: 'length' },
    ]);
    const agent = new ReviewAgent(llm);

    await expect(agent.review(INPUT, { model: 'agnes-2.5-flash' })).rejects.toThrow(/truncated/);
  });

  it('surfaces truncation for Anthropic-style stop_reason="max_tokens" with no content', async () => {
    const llm = new MockLLM([
      { content: '', toolCalls: [], usage: { inputTokens: 100, outputTokens: 8000 }, stopReason: 'max_tokens' },
    ]);
    const agent = new ReviewAgent(llm);

    await expect(agent.review(INPUT, { model: 'claude-sonnet-4-6' })).rejects.toThrow(/truncated/);
  });
});
