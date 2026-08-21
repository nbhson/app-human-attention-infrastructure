import { describe, expect, it } from 'vitest';

import type { LLMRequest } from '../llm/llm-provider.js';
import { MockLLM, mockTextResponse } from '../llm/mock-llm.js';

const REQUEST: LLMRequest = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 64,
};

describe('MockLLM', () => {
  it('returns scripted responses in order, then exhausts', async () => {
    const llm = new MockLLM([mockTextResponse('first'), mockTextResponse('second')]);

    await expect(llm.complete(REQUEST)).resolves.toMatchObject({ content: 'first' });
    await expect(llm.complete(REQUEST)).resolves.toMatchObject({ content: 'second' });
    await expect(llm.complete(REQUEST)).rejects.toThrow('MockLLM: script exhausted');
  });

  it('throws on script exhaustion from the start', async () => {
    const llm = new MockLLM([]);
    await expect(llm.complete(REQUEST)).rejects.toThrow('MockLLM: script exhausted');
  });

  it('records every request in calls', async () => {
    const llm = new MockLLM([mockTextResponse('ok')]);

    await llm.complete(REQUEST);

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.model).toBe('test-model');
    expect(llm.calls[0]?.messages[0]?.content).toBe('hi');
  });
});
