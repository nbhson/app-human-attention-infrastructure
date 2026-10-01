/**
 * `OpenAICompatibleProvider` (review-reorient Phase 3) — the generic OpenAI-style
 * {@link LLMProvider}, speaking `/chat/completions` over `fetch`.
 *
 * This is the "any provider" escape hatch the review slice needs: the human
 * configures `key` + `baseUrl` + `model`, and the provider talks to OpenAI,
 * Gemini (OpenAI-compat endpoint), opencode, or any self-hosted/proxied server.
 * It slots in behind the existing {@link LLMProvider} seam, so nothing outside
 * this package knows which vendor backed the call.
 */

import type { LLMProvider, LLMRequest, LLMResponse, LLMToolDefinition } from './llm-provider.js';
import { mapOpenAIResponse } from './map-openai-response.js';
import type { OpenAIChatCompletion } from './map-openai-response.js';

/** A provider-level failure, with a stable `kind` so callers can route to the right HTTP status. */
export class OpenAICompatibleError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'http' | 'network',
  ) {
    super(message);
    this.name = 'OpenAICompatibleError';
  }
}

export interface OpenAICompatibleConfig {
  readonly apiKey: string;
  /** The endpoint root, e.g. `https://api.openai.com/v1` — `/chat/completions` is appended. */
  readonly baseUrl: string;
  /** Fallback model id when a request doesn't supply its own. */
  readonly model: string;
  readonly temperature?: number;
  /** Per-request timeout in ms. Default 120_000 — a full review is long-form. */
  readonly timeoutMs?: number;
  /** Max retries for transient 429/5xx/network (default 2). P0 fix. */
  readonly maxRetries?: number;
  /**
   * Whether to translate `LLMRequest.jsonSchema` into a `response_format`
   * structured-output constraint. Default on.
   *
   * `AI_STRUCTURED_OUTPUT=0` turns it off for an OpenAI-compatible server that
   * rejects the `response_format` field. Turning it off is safe correctness-wise
   * — the caller still parses defensively — it just makes the envelope advisory
   * again, which is exactly the failure this exists to prevent.
   */
  readonly structuredOutput?: boolean;
  /** Injected transport — tests substitute a mock without stubbing globals. */
  readonly fetchImpl?: typeof fetch;
}

interface OpenAIChatRequest {
  readonly model: string;
  messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  readonly max_tokens: number;
  readonly temperature: number;
  /**
   * Thinking/reasoning budget for reasoning-capable models (Ollama exposes
   * this on `/v1/chat/completions` for thinking models). Only sent when the
   * caller explicitly sets `LLMRequest.reasoningEffort` — absent otherwise, so
   * servers that reject the field never see it unless the operator opted in.
   */
  reasoning_effort?: 'none' | 'low' | 'medium' | 'high';
  /**
   * Only sent when {@link LLMRequest.jsonSchema} asks for it and
   * {@link OpenAICompatibleConfig.structuredOutput} has not disabled it.
   */
  response_format?: {
    readonly type: 'json_schema';
    readonly json_schema: { readonly name: string; readonly schema: Record<string, unknown>; readonly strict: boolean };
  };
  tools?: ReadonlyArray<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
}

type OpenAITool = NonNullable<OpenAIChatRequest['tools']>[number];

function toOpenAITool(tool: LLMToolDefinition): OpenAITool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  };
}

export class OpenAICompatibleProvider implements LLMProvider {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = Math.max(0, config.maxRetries ?? 2);
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    let lastError: OpenAICompatibleError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.once(req);
      } catch (error) {
        lastError =
          error instanceof OpenAICompatibleError ? error : new OpenAICompatibleError(String(error), 'network');
        if (!this.isTransient(lastError) || attempt === this.maxRetries) throw lastError;
        await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 4000) + Math.floor(Math.random() * 250)));
      }
    }
    throw lastError ?? new OpenAICompatibleError('openai-compatible retry exhausted', 'network');
  }

  private isTransient(error: OpenAICompatibleError): boolean {
    if (error.kind === 'timeout' || error.kind === 'network') return true;
    return /\b(429|502|503|504)\b|rate limit/i.test(error.message);
  }

  private async once(req: LLMRequest): Promise<LLMResponse> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (req.systemPrompt !== undefined) {
      messages.push({ role: 'system', content: req.systemPrompt });
    }
    for (const m of req.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const body: OpenAIChatRequest = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens,
      temperature: this.config.temperature ?? 0,
      ...(req.reasoningEffort !== undefined ? { reasoning_effort: req.reasoningEffort } : {}),
    };
    // Grammar-constrained structured output. Deliberately NOT `json_object`: that
    // mode only guarantees "some valid JSON", and with the reviewer prompt's
    // 23k-char template a local model satisfies it by emitting a *fragment* of
    // the template (observed: `{"securityScore":75,"performanceScore":90,...}`
    // and nothing else — zero findings parsed). `json_schema` pins the whole
    // envelope, so `summary`, `overallVerdict`, and `healthScore` cannot go
    // missing. Ollama, OpenAI, and Gemini's compat layer all accept it.
    if (req.jsonSchema !== undefined && this.config.structuredOutput !== false) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'structured_output', schema: req.jsonSchema, strict: true },
      };
    }
    if (req.tools !== undefined && req.tools.length > 0) {
      body.tools = req.tools.map(toOpenAITool);
    }

    const url = this.config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey.length > 0 ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // An abort (our timeout) or a network drop. Surface a clear, typed failure
      // instead of hanging forever or leaking a bare 500 upstream.
      if (isAbortError(error)) {
        throw new OpenAICompatibleError(`openai-compatible ${url} timed out after ${this.timeoutMs}ms`, 'timeout');
      }
      throw new OpenAICompatibleError(
        `openai-compatible ${url} request failed: ${describeNetworkError(error, url)}`,
        'network',
      );
    }

    if (!response.ok) {
      const detail = await safeText(response);
      // Older Ollama / OpenAI-compatible servers reject `response_format` with a
      // 400. Retry once without the constraint — the caller still parses
      // defensively, so this degrades to advisory instead of failing the review.
      if (
        body.response_format !== undefined &&
        response.status === 400 &&
        /response_format|json_schema|strict|unsupported/i.test(detail)
      ) {
        const retryBody: Record<string, unknown> = { ...body };
        delete retryBody.response_format;
        try {
          const retry = await this.fetchImpl(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.config.apiKey.length > 0 ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
            },
            body: JSON.stringify(retryBody),
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (retry.ok) {
            return mapOpenAIResponse((await retry.json()) as OpenAIChatCompletion);
          }
          const retryDetail = await safeText(retry);
          throw new OpenAICompatibleError(
            `openai-compatible ${url} failed: ${retry.status} ${retry.statusText}${retryDetail ? ` — ${retryDetail}` : ''} (retried without response_format)`,
            'http',
          );
        } catch (error) {
          if (error instanceof OpenAICompatibleError) throw error;
          if (isAbortError(error)) {
            throw new OpenAICompatibleError(`openai-compatible ${url} timed out after ${this.timeoutMs}ms`, 'timeout');
          }
          throw new OpenAICompatibleError(
            `openai-compatible ${url} request failed: ${describeNetworkError(error, url)}`,
            'network',
          );
        }
      }
      throw new OpenAICompatibleError(
        `openai-compatible ${url} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
        'http',
      );
    }

    return mapOpenAIResponse((await response.json()) as OpenAIChatCompletion);
  }
}

/** True for the abort/timeout errors `AbortSignal.timeout` surfaces through `fetch`. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * Render a network failure with its undici `cause` plus an actionable hint.
 * `fetch failed` alone hides ECONNREFUSED (ollama down), ENOTFOUND (DNS), or
 * `localhost` resolving to the wrong loopback/container — all common with a
 * local Ollama endpoint.
 */
function describeNetworkError(error: unknown, url: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const causeMessage =
    error instanceof Error && (error as { cause?: unknown }).cause !== undefined
      ? String((error as { cause?: unknown }).cause)
      : '';
  const detail =
    causeMessage.length > 0 && !message.includes(causeMessage) ? `${message} (cause: ${causeMessage})` : message;
  const haystack = `${detail} ${url}`.toLowerCase();
  if (/econnrefused|econnreset|enotfound|eai_again|ehostunreach|epipe/.test(haystack)) {
    return (
      `${detail} — cannot reach the AI endpoint at ${url}. ` +
      `Check 'ollama serve' is running, 'ollama list' shows the model, ` +
      `try AI_BASE_URL=http://127.0.0.1:11434/v1 instead of localhost (IPv6 ::1 mismatch), ` +
      `or http://host.docker.internal:11434/v1 when the API runs in Docker`
    );
  }
  return `${detail} — cannot reach the AI endpoint at ${url}`;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}
