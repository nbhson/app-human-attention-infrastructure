import { describe, expect, it } from 'vitest';

import type { LLMRequest } from '../llm/llm-provider.js';
import { OpenAICompatibleProvider } from '../llm/openai-compatible-provider.js';

const REQUEST: LLMRequest = {
  model: 'deepseek-v4-pro-0813',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 64,
};

const CONFIG = {
  apiKey: 'test-key',
  baseUrl: 'https://api.example.com/v1',
  model: 'deepseek-v4-pro-0813',
};

/** A transport that never settles on its own — it only rejects when the signal aborts. */
function hangingFetch(): typeof fetch {
  return (_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('This operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
}

/** A transport returning a fixed JSON body with the given status. */
function stubFetch(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

const OK_BODY = {
  choices: [{ message: { content: 'reviewed' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 5, completion_tokens: 2 },
};

describe('OpenAICompatibleProvider', () => {
  it('aborts a hung upstream after timeoutMs and throws a timeout error', async () => {
    const provider = new OpenAICompatibleProvider({
      ...CONFIG,
      timeoutMs: 10,
      fetchImpl: hangingFetch(),
    });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      name: 'OpenAICompatibleError',
      kind: 'timeout',
    });
  });

  it('surfaces a non-2xx upstream as an http error', async () => {
    const provider = new OpenAICompatibleProvider({
      ...CONFIG,
      fetchImpl: stubFetch(401, { error: 'bad key' }),
    });

    await expect(provider.complete(REQUEST)).rejects.toThrow(
      'openai-compatible https://api.example.com/v1/chat/completions failed: 401',
    );
  });

  it('surfaces a network drop as a network error', async () => {
    const provider = new OpenAICompatibleProvider({
      ...CONFIG,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      name: 'OpenAICompatibleError',
      kind: 'network',
    });
  });

  it('maps a 200 response through the shared OpenAI mapper', async () => {
    const provider = new OpenAICompatibleProvider({
      ...CONFIG,
      fetchImpl: stubFetch(200, OK_BODY),
    });

    await expect(provider.complete(REQUEST)).resolves.toMatchObject({
      content: 'reviewed',
      usage: { inputTokens: 5, outputTokens: 2 },
    });
  });
});
