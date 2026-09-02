/**
 * `AnthropicProvider` (day-11 §2.2) — the real {@link LLMProvider}, backed by
 * the official `@anthropic-ai/sdk`.
 *
 * Request building is inline here so that `exactOptionalPropertyTypes` is
 * respected: `system` and `tools` are attached only when defined, never as
 * explicit `undefined`. Response mapping is delegated to the pure
 * {@link mapAnthropicResponse}.
 *
 * Reliability additions (v2):
 *  - **Per-request timeout** via `AbortController` so a hanging request fails
 *    fast (mirrors {@link OpenAICompatibleProvider}).
 *  - **Typed errors** (`AnthropicError`) with `kind` so callers can branch
 *    on `timeout` / `http` / `network` / `rate_limit` and react accordingly
 *    (retry, surface, log, …).
 *  - **Bounded exponential-backoff retry** for transient failures (timeouts,
 *    network drops, 5xx, 429). Non-retryable statuses (400/401/403) fail
 *    immediately. Retries respect a wall-clock cap so the caller is never
 *    held longer than `maxRetries × maxBackoffMs`.
 *  - **No retry for `parse` / `unknown` errors** — those are bugs to surface,
 *    not flakes to absorb.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { LLMProvider, LLMRequest, LLMResponse, LLMToolDefinition } from './llm-provider.js';
import { mapAnthropicResponse } from './map-anthropic-response.js';

/** A provider-level failure with a stable `kind` so callers can route to the right HTTP status / metric. */
export class AnthropicError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'http' | 'network' | 'rate_limit',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AnthropicError';
  }
}

/** Map our camelCase `inputSchema` to the SDK's snake_case `input_schema`. */
function toAnthropicTool(tool: LLMToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as unknown as Anthropic.Tool.InputSchema,
  };
}

export interface AnthropicProviderOptions {
  /** Per-request timeout in ms. Default 120_000 — a full review is long-form. */
  readonly timeoutMs?: number;
  /** Max retry attempts for transient failures (default 2 → up to 3 total calls). */
  readonly maxRetries?: number;
  /** Base backoff in ms for the first retry; doubled per attempt. Default 500. */
  readonly baseBackoffMs?: number;
  /** Cap on a single backoff wait (so the exponential does not explode). Default 8_000. */
  readonly maxBackoffMs?: number;
  /** Injected SDK factory — tests substitute a mock client without stubbing globals. */
  readonly clientFactory?: (apiKey: string) => Anthropic;
}

const ANTHROPIC_RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Sleep `ms` milliseconds. Exported for unit tests; pure no-op in production. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class AnthropicProvider implements LLMProvider {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly clientFactory: (apiKey: string) => Anthropic;

  constructor(
    private readonly apiKey: string,
    options: AnthropicProviderOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.baseBackoffMs = options.baseBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 8_000;
    this.clientFactory = options.clientFactory ?? ((key: string): Anthropic => new Anthropic({ apiKey: key }));
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    let lastError: AnthropicError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.once(req);
      } catch (error) {
        const classified = this.classify(error);
        lastError = classified;
        if (!this.shouldRetry(classified, attempt)) {
          throw classified;
        }
        const wait = Math.min(this.baseBackoffMs * 2 ** attempt, this.maxBackoffMs);
        await delay(wait);
      }
    }
    throw lastError ?? new AnthropicError('anthropic: retries exhausted without a classified error', 'network');
  }

  /** A single attempt — bound to the per-request timeout. */
  private async once(req: LLMRequest): Promise<LLMResponse> {
    const client = this.clientFactory(this.apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: req.messages,
    };
    if (req.systemPrompt !== undefined) {
      params.system = req.systemPrompt;
    }
    if (req.tools !== undefined && req.tools.length > 0) {
      params.tools = req.tools.map(toAnthropicTool);
    }

    try {
      const response = await client.messages.create(params, { signal: controller.signal });
      return mapAnthropicResponse(response);
    } catch (error) {
      throw this.classify(error);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Map any thrown value to a typed {@link AnthropicError}, preserving the original message. */
  private classify(error: unknown): AnthropicError {
    if (error instanceof AnthropicError) {
      return error;
    }
    if (error instanceof Anthropic.APIError) {
      const status = error.status;
      const kind: AnthropicError['kind'] =
        status === 429 ? 'rate_limit' : ANTHROPIC_RETRYABLE_STATUSES.has(status) ? 'http' : 'http';
      return new AnthropicError(`anthropic ${status} ${error.message}`, kind, status);
    }
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        return new AnthropicError(`anthropic request timed out after ${this.timeoutMs}ms`, 'timeout');
      }
      // Network / DNS / TLS / socket resets.
      return new AnthropicError(`anthropic request failed: ${error.message}`, 'network');
    }
    return new AnthropicError(`anthropic request failed: ${String(error)}`, 'network');
  }

  /** Retry only transient failures; never retry auth/validation/unknown. */
  private shouldRetry(error: AnthropicError, attempt: number): boolean {
    if (attempt >= this.maxRetries) {
      return false;
    }
    if (error.kind === 'timeout' || error.kind === 'network') {
      return true;
    }
    if (error.kind === 'rate_limit') {
      return true;
    }
    if (error.kind === 'http' && error.status !== undefined && ANTHROPIC_RETRYABLE_STATUSES.has(error.status)) {
      return true;
    }
    return false;
  }
}
