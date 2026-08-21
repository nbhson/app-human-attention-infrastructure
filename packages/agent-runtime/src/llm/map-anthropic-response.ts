/**
 * Pure mapper from the Anthropic SDK's `Message` shape to our normalised
 * {@link LLMResponse} (day-11 §2.2).
 *
 * Kept separate from {@link AnthropicProvider} so the mapping can be unit-tested
 * against a fixture without making a live API call. It is the *only* place that
 * touches the SDK's response block union.
 */

import type Anthropic from '@anthropic-ai/sdk';

import type { LLMResponse } from './llm-provider.js';

type TextBlock = Extract<Anthropic.ContentBlock, { type: 'text' }>;
type ToolUseBlock = Extract<Anthropic.ContentBlock, { type: 'tool_use' }>;

const isTextBlock = (block: Anthropic.ContentBlock): block is TextBlock => block.type === 'text';
const isToolUseBlock = (block: Anthropic.ContentBlock): block is ToolUseBlock =>
  block.type === 'tool_use';

export function mapAnthropicResponse(message: Anthropic.Message): LLMResponse {
  const content = message.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('');

  const toolCalls = message.content.filter(isToolUseBlock).map((block) => ({
    id: block.id,
    name: block.name,
    input: (block.input ?? {}) as Record<string, unknown>,
  }));

  return {
    content,
    toolCalls,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
    stopReason: message.stop_reason ?? 'unknown',
  };
}
