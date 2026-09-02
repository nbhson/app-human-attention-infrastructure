import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { llmCallLog } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { AnthropicError } from '../llm/anthropic-provider.js';
import type { LLMRequest } from '../llm/llm-provider.js';
import { LoggingLLMProvider } from '../llm/logging-provider.js';
import { MockLLM, mockTextResponse } from '../llm/mock-llm.js';
import { OpenAICompatibleError } from '../llm/openai-compatible-provider.js';

const SCHEMA = 'harness_test_llm_logging';

const REQUEST: LLMRequest = {
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 1024,
};

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await testDb.db.delete(llmCallLog);
});

/** Helper: return a mock inner provider that rejects with the given error. */
function failingInner(error: unknown): MockLLM {
  const m = new MockLLM([]);
  // Directly replace the method so spies aren't needed.
  // Use Object.defineProperty to avoid any potential descriptor issues.
  Object.defineProperty(m, 'complete', {
    value: vi.fn(async () => {
      throw error;
    }),
    writable: false,
    configurable: false,
  });
  return m;
}

describe('LoggingLLMProvider', () => {
  it('delegates to the inner provider and returns its response', async () => {
    const inner = new MockLLM([mockTextResponse('hello')]);
    const provider = new LoggingLLMProvider(inner, testDb.db);

    const res = await provider.complete(REQUEST);

    expect(res.content).toBe('hello');
    expect(inner.calls).toHaveLength(1);
  });

  it('writes exactly one llm_call_log row per call with status=OK on success', async () => {
    const inner = new MockLLM([mockTextResponse('one'), mockTextResponse('two')]);
    const provider = new LoggingLLMProvider(inner, testDb.db);

    await provider.complete(REQUEST);
    await provider.complete({ ...REQUEST, messages: [{ role: 'user', content: 'again' }] });

    const rows = await testDb.db.select().from(llmCallLog);
    expect(rows).toHaveLength(2);

    const first = rows[0];
    expect(first?.model).toBe('claude-sonnet-4-6');
    expect(first?.input_tokens).toBe(10);
    expect(first?.output_tokens).toBe(5);
    expect(first?.stop_reason).toBe('end_turn');
    expect(first?.status).toBe('OK');
    expect(first?.error).toBeNull();
    expect(first?.agent_run_id).toBeNull();
    expect(first?.request_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a row with status=TIMEOUT when the inner provider times out (and re-throws)', async () => {
    const timeoutError = new AnthropicError('anthropic request timed out after 100ms', 'timeout');
    const inner = failingInner(timeoutError);
    const provider = new LoggingLLMProvider(inner, testDb.db);

    await expect(provider.complete(REQUEST)).rejects.toBe(timeoutError);

    const rows = await testDb.db.select().from(llmCallLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('TIMEOUT');
    expect(rows[0]?.error).toMatch(/timed out/);
  });

  it('classifies OpenAI-compatible network errors as NETWORK', async () => {
    const netError = new OpenAICompatibleError('openai-compatible network down', 'network');
    const inner = failingInner(netError);
    const provider = new LoggingLLMProvider(inner, testDb.db);

    await expect(provider.complete(REQUEST)).rejects.toBe(netError);

    const rows = await testDb.db.select().from(llmCallLog);
    expect(rows[0]?.status).toBe('NETWORK');
    expect(rows[0]?.error).toMatch(/network/);
  });

  it('classifies Anthropic rate_limit errors as RATE_LIMIT', async () => {
    const rateError = new AnthropicError('anthropic 429 too many', 'rate_limit', 429);
    const inner = failingInner(rateError);
    const provider = new LoggingLLMProvider(inner, testDb.db);

    await expect(provider.complete(REQUEST)).rejects.toBe(rateError);

    const rows = await testDb.db.select().from(llmCallLog);
    expect(rows[0]?.status).toBe('RATE_LIMIT');
    expect(rows[0]?.error).toMatch(/429/);
  });

  it('classifies unknown errors as UNKNOWN and never swallows the throw', async () => {
    const genericError = new Error('boom');
    const inner = failingInner(genericError);
    const provider = new LoggingLLMProvider(inner, testDb.db);

    await expect(provider.complete(REQUEST)).rejects.toBe(genericError);

    const rows = await testDb.db.select().from(llmCallLog);
    expect(rows[0]?.status).toBe('UNKNOWN');
    expect(rows[0]?.error).toMatch(/boom/);
  });
});
