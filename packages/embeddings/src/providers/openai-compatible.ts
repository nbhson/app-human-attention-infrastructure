/**
 * OpenAI-compatible embedder (day-16 §3.3) — a batched, order-preserving
 * provider over a `POST /embeddings` endpoint.
 *
 * The one hard rule (day-16 §2.2 rule 2, §6): this class must **never throw**
 * into its caller. A 429, a 5xx, a network drop, or a dimension-drift response
 * all resolve to a typed {@link EmbedError} via the {@link EmbedResult}
 * discriminator. Transient failures retry with deterministic exponential
 * backoff (no jitter — tests can assert exact call counts); non-retryable
 * failures (4xx except 429, malformed bodies, dimension drift) surface
 * immediately so they are logged, not retried into silence.
 */

import type { Embedder, EmbedError, EmbedQueryResult, EmbedResult } from '../embedder.js';

/** Configuration for {@link OpenAICompatibleEmbedder}. */
export interface OpenAICompatibleConfig {
  /** Origin, e.g. `https://api.openai.com/v1` (a trailing slash is tolerated). */
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Embeddings model id, e.g. `text-embedding-3-small`. */
  readonly model: string;
  /** Expected output width; defaults to 1536 (`text-embedding-3-small`). */
  readonly dimensions?: number;
  /** Max retry attempts *after* the first request. Default 2. */
  readonly maxRetries?: number;
  /** Base backoff delay in ms; doubles each attempt. Default 500. */
  readonly retryDelayMs?: number;
  /** Per-request timeout in ms. Default 10_000. */
  readonly timeoutMs?: number;
  /** Injected transport — tests substitute a mock without stubbing globals. */
  readonly fetchImpl?: typeof fetch;
}

/** The subset of the `/embeddings` response this adapter reads. */
interface EmbeddingsResponseBody {
  readonly data?: readonly { readonly embedding?: readonly number[] }[];
}

export class OpenAICompatibleEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAICompatibleConfig) {
    this.endpoint = `${config.baseUrl.replace(/\/+$/, '')}/embeddings`;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.dimensions = config.dimensions ?? 1536;
    this.maxRetries = config.maxRetries ?? 2;
    this.retryDelayMs = config.retryDelayMs ?? 500;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async embed(texts: readonly string[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      return { ok: true, vectors: [] };
    }

    let lastError: EmbedError = {
      kind: 'embed_error',
      message: 'embedding request failed',
      retryable: false,
    };

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({ model: this.model, input: [...texts] }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          lastError = {
            kind: 'embed_error',
            message: `embeddings endpoint returned HTTP ${response.status}`,
            retryable: response.status === 429 || response.status >= 500,
          };
        } else {
          const parsed = this.parseResponse((await response.json()) as EmbeddingsResponseBody, texts.length);
          if (parsed.ok) {
            return parsed;
          }
          lastError = parsed.error;
        }
      } catch (error) {
        // Network drop, abort (timeout), or a throw during body parse — all
        // transient; surface as a retryable typed error rather than propagating.
        lastError = {
          kind: 'embed_error',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        };
      }

      if (!lastError.retryable) {
        break;
      }
      if (attempt < this.maxRetries) {
        await sleep(this.retryDelayMs * 2 ** attempt);
      }
    }

    return { ok: false, error: lastError };
  }

  async embedQuery(text: string): Promise<EmbedQueryResult> {
    const result = await this.embed([text]);
    if (!result.ok) {
      return result;
    }
    return { ok: true, vector: result.vectors[0] as number[] };
  }

  /** Validate the response shape and per-vector width; never throw. */
  private parseResponse(body: EmbeddingsResponseBody, expectedCount: number): EmbedResult {
    const data = body.data;
    if (!Array.isArray(data)) {
      return {
        ok: false,
        error: { kind: 'embed_error', message: 'response missing `data` array', retryable: false },
      };
    }
    if (data.length !== expectedCount) {
      return {
        ok: false,
        error: {
          kind: 'embed_error',
          message: `expected ${expectedCount} vectors, received ${data.length}`,
          retryable: false,
        },
      };
    }

    const vectors: number[][] = [];
    for (const item of data) {
      const embedding = item.embedding;
      if (!Array.isArray(embedding) || embedding.some((component) => typeof component !== 'number')) {
        return {
          ok: false,
          error: { kind: 'embed_error', message: 'malformed embedding vector', retryable: false },
        };
      }
      if (embedding.length !== this.dimensions) {
        // Dimension drift (day-16 §6) — a wrong model, not a transient outage.
        return {
          ok: false,
          error: {
            kind: 'embed_error',
            message: `dimension drift: expected ${this.dimensions}, received ${embedding.length}`,
            retryable: false,
          },
        };
      }
      vectors.push(embedding as number[]);
    }

    return { ok: true, vectors };
  }
}

/** Resolve after `ms`, with `0` resolving on the next macrotask tick. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
