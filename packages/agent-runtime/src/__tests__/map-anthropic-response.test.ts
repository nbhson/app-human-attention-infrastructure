import { readFileSync } from 'node:fs';

import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { mapAnthropicResponse } from '../llm/map-anthropic-response.js';

/** Load a redacted, real-shaped `Message` fixture (day-11 §6). */
function loadFixture(name: string): Anthropic.Message {
  const raw = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return JSON.parse(raw) as unknown as Anthropic.Message;
}

describe('mapAnthropicResponse', () => {
  it('maps a text-only message', () => {
    const res = mapAnthropicResponse(loadFixture('text-message.json'));

    expect(res.content).toBe('Hello, world.');
    expect(res.toolCalls).toEqual([]);
    expect(res.stopReason).toBe('end_turn');
  });

  it('maps a message with tool calls', () => {
    const res = mapAnthropicResponse(loadFixture('tool-use-message.json'));

    expect(res.content).toBe('');
    expect(res.toolCalls).toEqual([
      { id: 'toolu_01TestToolUseId00001', name: 'runCommand', input: { command: 'ls -la' } },
    ]);
    expect(res.stopReason).toBe('tool_use');
  });

  it('maps usage fields correctly', () => {
    const res = mapAnthropicResponse(loadFixture('text-message.json'));

    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it('falls back to "unknown" when stop_reason is null', () => {
    const text = loadFixture('text-message.json');

    expect(mapAnthropicResponse({ ...text, stop_reason: null }).stopReason).toBe('unknown');
  });
});
