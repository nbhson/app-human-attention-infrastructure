/**
 * Pure mapper from an OpenAI-compatible `/chat/completions` response to our
 * normalised {@link LLMResponse} (review-reorient Phase 3).
 *
 * Kept separate from {@link OpenAICompatibleProvider} so the mapping can be
 * unit-tested against a fixture without a live call — the same split as
 * `map-anthropic-response.ts`.
 */

import type { LLMResponse } from './llm-provider.js';

/** Subset of an OpenAI-compatible `/chat/completions` response body. */
export interface OpenAIChatCompletion {
  readonly choices: ReadonlyArray<{
    readonly message: {
      readonly content: string | null;
      readonly tool_calls?: ReadonlyArray<{
        readonly id: string;
        readonly type: 'function';
        readonly function: { readonly name: string; readonly arguments?: string };
      }>;
    };
    readonly finish_reason: string | null;
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function mapOpenAIResponse(response: OpenAIChatCompletion): LLMResponse {
  const choice = response.choices[0];
  const content = choice?.message.content ?? '';
  const toolCalls = (choice?.message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: parseToolArguments(tc.function.arguments),
  }));

  return {
    content,
    toolCalls,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
    stopReason: choice?.finish_reason ?? 'unknown',
  };
}
