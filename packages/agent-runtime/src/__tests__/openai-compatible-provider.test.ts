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

  it('sends a response_format json_schema constraint when the request declares a jsonSchema', async () => {
    const bodies: unknown[] = [];
    const provider = new OpenAICompatibleProvider({
      ...CONFIG,
      fetchImpl: (async (_input: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(OK_BODY), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });

    await provider.complete({ ...REQUEST, jsonSchema: { type: 'object' } });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'structured_output', schema: { type: 'object' }, strict: true },
      },
    });
  });

  it('omits response_format when no jsonSchema is declared', async () => {
    const bodies: unknown[] = [];
    const provider = new OpenAICompatibleProvider({
      ...CONFIG,
      fetchImpl: (async (_input: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(OK_BODY), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });

    await provider.complete(REQUEST);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('response_format');
  });

  it('omits response_format when structuredOutput is false even with a jsonSchema', async () => {
    const bodies: unknown[] = [];
    const provider = new OpenAICompatibleProvider({
      ...CONFIG,
      structuredOutput: false,
      fetchImpl: (async (_input: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(OK_BODY), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });

    await provider.complete({ ...REQUEST, jsonSchema: { type: 'object' } });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('response_format');
  });

  it('includes the endpoint and a hint when the network drops with a cause', async () => {
    const provider = new OpenAICompatibleProvider({
      ...CONFIG,
      maxRetries: 0,
      fetchImpl: (async () => {
        const error = new TypeError('fetch failed');
        (error as { cause?: unknown }).cause = new Error('connect ECONNREFUSED 127.0.0.1:11434');
        throw error;
      }) as typeof fetch,
    });

    const error = await provider.complete(REQUEST).catch((e: unknown) => e);
    expect(String((error as Error).message)).toMatch(/ECONNREFUSED/i);
    expect(String((error as Error).message)).toMatch(/cannot reach the AI endpoint/i);
    expect(String((error as Error).message)).toMatch(/ollama serve/i);
  });

  it('retries once without response_format when the server rejects it with 400', async () => {
    const bodies: unknown[] = [];
    let calls = 0;
    const provider = new OpenAICompatibleProvider({
      ...CONFIG,
      maxRetries: 0,
      fetchImpl: (async (_input: unknown, init?: RequestInit) => {
        calls += 1;
        bodies.push(JSON.parse(String(init?.body)));
        if (calls === 1) {
          return new Response(JSON.stringify({ error: 'response_format json_schema unsupported' }), {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(OK_BODY), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });

    await expect(provider.complete({ ...REQUEST, jsonSchema: { type: 'object' } })).resolves.toMatchObject({
      content: 'reviewed',
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty('response_format');
    expect(bodies[1]).not.toHaveProperty('response_format');
  });
});
