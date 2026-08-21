import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { llmCallLog } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import type { LLMRequest } from '../llm/llm-provider.js';
import { LoggingLLMProvider } from '../llm/logging-provider.js';
import { MockLLM, mockTextResponse } from '../llm/mock-llm.js';

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

describe('LoggingLLMProvider', () => {
  it('delegates to the inner provider and returns its response', async () => {
    const inner = new MockLLM([mockTextResponse('hello')]);
    const provider = new LoggingLLMProvider(inner, testDb.db);

    const res = await provider.complete(REQUEST);

    expect(res.content).toBe('hello');
    expect(inner.calls).toHaveLength(1);
  });

  it('writes exactly one llm_call_log row per call', async () => {
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
    expect(first?.agent_run_id).toBeNull();
    expect(first?.request_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
