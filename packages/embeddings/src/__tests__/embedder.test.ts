import { describe, expect, it, vi } from 'vitest';

import type { EmbedResult } from '../embedder.js';
import { OpenAICompatibleEmbedder, type OpenAICompatibleConfig } from '../providers/openai-compatible.js';
import { StubEmbedder } from '../providers/stub.js';

/** Build a mock `Response` from an OpenAI-style embeddings body. */
function embeddingsResponse(vectors: number[][], status = 200): Response {
  return new Response(JSON.stringify({ data: vectors.map((embedding, index) => ({ index, embedding })) }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A 3-dimension canned body, for an adapter configured with `dimensions: 3`. */
const DIMS = 3;

describe('StubEmbedder', () => {
  it('is deterministic — two runs over the same batch are byte-identical', async () => {
    const stub = new StubEmbedder(8);
    const first = await stub.embed(['alpha', 'beta']);
    const second = await stub.embed(['alpha', 'beta']);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first).toEqual(second);
  });

  it('is order-preserving and distinct per input', async () => {
    const stub = new StubEmbedder(8);
    const result = await stub.embed(['alpha', 'beta', 'alpha']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vectors).toHaveLength(3);
    // Same text → same vector; different text → different vector.
    expect(result.vectors[0]).toEqual(result.vectors[2]);
    expect(result.vectors[0]).not.toEqual(result.vectors[1]);
  });

  it('emits unit-length vectors of the advertised dimension', async () => {
    const stub = new StubEmbedder(16);
    const result = await stub.embed(['gamma']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vector = result.vectors[0] as number[];
    expect(vector).toHaveLength(16);
    const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('exposes dimensions and model from its constructor', () => {
    const stub = new StubEmbedder(32, 'test-model');
    expect(stub.dimensions).toBe(32);
    expect(stub.model).toBe('test-model');
  });
});

describe('OpenAICompatibleEmbedder', () => {
  const baseConfig: OpenAICompatibleConfig = {
    baseUrl: 'https://embeddings.example/v1/',
    apiKey: 'test-key',
    model: 'text-embedding-3-small',
    dimensions: DIMS,
    maxRetries: 0,
    retryDelayMs: 0,
  };

  it('maps a canned response to n × dims, order preserved', async () => {
    const body = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ];
    const mockFetch = vi.fn<typeof fetch>(async () => embeddingsResponse(body));
    const adapter = new OpenAICompatibleEmbedder({ ...baseConfig, fetchImpl: mockFetch });

    const result = await adapter.embed(['first', 'second']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vectors).toEqual(body);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('requests the configured model against {baseUrl}/embeddings', async () => {
    const mockFetch = vi.fn<typeof fetch>(async () => embeddingsResponse([[0, 0, 0]]));
    const adapter = new OpenAICompatibleEmbedder({ ...baseConfig, fetchImpl: mockFetch });

    await adapter.embed(['x']);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://embeddings.example/v1/embeddings');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'text-embedding-3-small',
      input: ['x'],
    });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
  });

  it('returns a non-throwing, retryable error on a network failure', async () => {
    const mockFetch = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED');
    });
    const adapter = new OpenAICompatibleEmbedder({ ...baseConfig, fetchImpl: mockFetch });

    await expect(adapter.embed(['x'])).resolves.toMatchObject({
      ok: false,
      error: { kind: 'embed_error', retryable: true },
    });
  });

  it('retries a 429 and succeeds on the next attempt', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(embeddingsResponse([[0.1, 0.2, 0.3]]));
    const adapter = new OpenAICompatibleEmbedder({
      ...baseConfig,
      fetchImpl: mockFetch,
      maxRetries: 2,
    });

    const result = await adapter.embed(['retry-me']);

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('surfaces a non-retryable error without retrying on a 400', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('bad request', { status: 400 }));
    const adapter = new OpenAICompatibleEmbedder({
      ...baseConfig,
      fetchImpl: mockFetch,
      maxRetries: 3,
    });

    const result = await adapter.embed(['x']);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reports dimension drift as a non-retryable error', async () => {
    const mockFetch = vi.fn<typeof fetch>(async () => embeddingsResponse([[1, 2]])); // 2 dims ≠ 3
    const adapter = new OpenAICompatibleEmbedder({ ...baseConfig, fetchImpl: mockFetch });

    const result = await adapter.embed(['x']);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toContain('dimension drift');
  });

  it('returns an empty success for an empty batch without calling the endpoint', async () => {
    const mockFetch = vi.fn<typeof fetch>();
    const adapter = new OpenAICompatibleEmbedder({ ...baseConfig, fetchImpl: mockFetch });

    const result = (await adapter.embed([])) as EmbedResult;

    expect(result).toEqual({ ok: true, vectors: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
