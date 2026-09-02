import { describe, expect, it } from 'vitest';

import { mapOpenAIResponse } from '../llm/map-openai-response.js';
import type { OpenAIChatCompletion } from '../llm/map-openai-response.js';

describe('mapOpenAIResponse', () => {
  it('maps a text-only completion', () => {
    const res = mapOpenAIResponse({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    });

    expect(res.content).toBe('hello');
    expect(res.toolCalls).toEqual([]);
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
    expect(res.stopReason).toBe('stop');
  });

  it('maps tool calls and parses their JSON arguments', () => {
    const res = mapOpenAIResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 't1',
                type: 'function',
                function: { name: 'runCommand', arguments: '{"command":"ls -la"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });

    expect(res.content).toBe('');
    expect(res.toolCalls).toEqual([{ id: 't1', name: 'runCommand', input: { command: 'ls -la' } }]);
    expect(res.stopReason).toBe('tool_calls');
  });

  it('tolerates malformed tool arguments', () => {
    const res = mapOpenAIResponse({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [{ id: 't2', type: 'function', function: { name: 'f', arguments: 'not json' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });

    expect(res.toolCalls[0]?.input).toEqual({});
  });

  it('falls back to empty content / unknown for a missing choice', () => {
    const empty: OpenAIChatCompletion = { choices: [] };
    const res = mapOpenAIResponse(empty);

    expect(res.content).toBe('');
    expect(res.toolCalls).toEqual([]);
    expect(res.stopReason).toBe('unknown');
  });
});
