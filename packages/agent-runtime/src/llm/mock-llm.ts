/**
 * `MockLLM` (day-11 §2.3) — a deterministic, scriptable {@link LLMProvider}.
 *
 * It replays a queue of pre-canned responses, one per `complete` call, and
 * records every request it received. Tests assert on prompt content in
 * {@link MockLLM.calls} instead of reaching for a mocking framework.
 *
 * Script exhaustion is an explicit error, not a silent `undefined`: a test that
 * runs one more turn than scripted should fail loudly rather than pass vacuously.
 */

import type { LLMProvider, LLMRequest, LLMResponse } from './llm-provider.js';

export type MockScript = LLMResponse[];

export class MockLLM implements LLMProvider {
  private readonly queue: LLMResponse[];
  public readonly calls: LLMRequest[] = [];

  constructor(script: MockScript) {
    this.queue = [...script];
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push(req);
    const next = this.queue.shift();
    if (!next) {
      throw new Error('MockLLM: script exhausted');
    }
    return next;
  }
}

/** A plain-text response factory, for wiring happy-path scripts. */
export function mockTextResponse(content: string, inputTokens = 10, outputTokens = 5): LLMResponse {
  return { content, toolCalls: [], usage: { inputTokens, outputTokens }, stopReason: 'end_turn' };
}

/** A tool-use response factory, for wiring single-tool-call scripts. */
export function mockToolCallResponse(toolName: string, toolId: string, input: Record<string, unknown>): LLMResponse {
  return {
    content: '',
    toolCalls: [{ id: toolId, name: toolName, input }],
    usage: { inputTokens: 10, outputTokens: 8 },
    stopReason: 'tool_use',
  };
}
