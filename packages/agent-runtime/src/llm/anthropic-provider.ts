/**
 * `AnthropicProvider` (day-11 §2.2) — the real {@link LLMProvider}, backed by
 * the official `@anthropic-ai/sdk`.
 *
 * Request building is inline here so that `exactOptionalPropertyTypes` is
 * respected: `system` and `tools` are attached only when defined, never as
 * explicit `undefined`. Response mapping is delegated to the pure
 * {@link mapAnthropicResponse}.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { LLMProvider, LLMRequest, LLMResponse, LLMToolDefinition } from './llm-provider.js';
import { mapAnthropicResponse } from './map-anthropic-response.js';

/** Map our camelCase `inputSchema` to the SDK's snake_case `input_schema`. */
function toAnthropicTool(tool: LLMToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as unknown as Anthropic.Tool.InputSchema,
  };
}

export class AnthropicProvider implements LLMProvider {
  constructor(private readonly apiKey: string) {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const client = new Anthropic({ apiKey: this.apiKey });

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

    const response = await client.messages.create(params);
    return mapAnthropicResponse(response);
  }
}
