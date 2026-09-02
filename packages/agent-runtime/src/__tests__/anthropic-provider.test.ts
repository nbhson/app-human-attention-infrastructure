/**
 * Tests for the AnthropicProvider v2 reliability additions: timeout, typed
 * errors, bounded exponential-backoff retry. The SDK is never constructed in
 * these tests — `clientFactory` injects a stub.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicError, AnthropicProvider } from '../llm/anthropic-provider.js';
import type { LLMRequest } from '../llm/llm-provider.js';

const REQUEST: LLMRequest = {
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 1024,
};

/** Build a stub SDK whose `messages.create` resolves with the given fixture or throws the given error. */
function buildStubSdk(
  behavior: 'ok' | 'throw',
  payload:
    { kind: 'ok'; content: string; stopReason: string; in: number; out: number } | { kind: 'throw'; error: unknown },
) {
  const create = vi.fn(async () => {
    if (payload.kind === 'throw') {
      throw payload.error;
    }
    return {
      content: [{ type: 'text', text: payload.content }],
      stop_reason: payload.stopReason,
      usage: { input_tokens: payload.in, output_tokens: payload.out },
    };
  });
  return { messages: { create } };
}

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the response on a successful first attempt', async () => {
    const sdk = buildStubSdk('ok', { kind: 'ok', content: 'hi', stopReason: 'end_turn', in: 5, out: 3 });
    const provider = new AnthropicProvider('sk-test', {
      clientFactory: () => sdk as never,
      maxRetries: 0,
    });

    const res = await provider.complete(REQUEST);

    expect(res.content).toBe('hi');
    expect(sdk.messages.create).toHaveBeenCalledTimes(1);
  });

  it('classifies a generic Error as network', async () => {
    const sdk = buildStubSdk('throw', { kind: 'throw', error: new Error('socket reset') });
    const provider = new AnthropicProvider('sk-test', {
      clientFactory: () => sdk as never,
      maxRetries: 0,
    });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({ kind: 'network' });
  });

  it('classifies an AbortError as timeout', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    const sdk = buildStubSdk('throw', { kind: 'throw', error: err });
    const provider = new AnthropicProvider('sk-test', {
      clientFactory: () => sdk as never,
      timeoutMs: 50,
      maxRetries: 0,
    });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('retries on transient failure then succeeds', async () => {
    const sdk = {
      messages: {
        create: vi
          .fn()
          .mockRejectedValueOnce(new Error('ECONNRESET'))
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 3 },
          }),
      },
    };
    const provider = new AnthropicProvider('sk-test', {
      clientFactory: () => sdk as never,
      maxRetries: 2,
      baseBackoffMs: 1,
      maxBackoffMs: 1,
    });

    const res = await provider.complete(REQUEST);

    expect(res.content).toBe('ok');
    expect(sdk.messages.create).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a non-retryable HTTP status (400)', async () => {
    // A 400 Bad Request is non-retryable — the provider should surface it
    // immediately without bouncing through the retry loop.
    const sdk = buildStubSdk('throw', {
      kind: 'throw',
      error: new AnthropicError('bad request', 'http', 400),
    });
    const provider = new AnthropicProvider('sk-test', {
      clientFactory: () => sdk as never,
      maxRetries: 3,
      baseBackoffMs: 1,
      maxBackoffMs: 1,
    });

    await expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(AnthropicError);
    expect(sdk.messages.create).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    const rateErr = Object.assign(new Error('rate limited'), { status: 429 });
    const sdk = {
      messages: {
        create: vi
          .fn()
          .mockRejectedValueOnce(rateErr)
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
      },
    };
    const provider = new AnthropicProvider('sk-test', {
      clientFactory: () => sdk as never,
      maxRetries: 2,
      baseBackoffMs: 1,
      maxBackoffMs: 1,
    });

    const res = await provider.complete(REQUEST);

    expect(res.content).toBe('ok');
    expect(sdk.messages.create).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries then throws the last classified error', async () => {
    const sdk = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('boom')),
      },
    };
    const provider = new AnthropicProvider('sk-test', {
      clientFactory: () => sdk as never,
      maxRetries: 2,
      baseBackoffMs: 1,
      maxBackoffMs: 1,
    });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({ kind: 'network' });
    expect(sdk.messages.create).toHaveBeenCalledTimes(3);
  });
});
