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
  /** Injected transport — tests substitute a mock without stubbing globals. */
  readonly fetchImpl?: typeof fetch;
}

interface OpenAIChatRequest {
  readonly model: string;
  messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  readonly max_tokens: number;
  readonly temperature: number;
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
    };
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
        `openai-compatible ${url} request failed: ${error instanceof Error ? error.message : String(error)}`,
        'network',
      );
    }

    if (!response.ok) {
      const detail = await safeText(response);
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

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}
