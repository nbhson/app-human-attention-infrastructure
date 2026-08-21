import { describe, expect, it } from 'vitest';

import { MockLLM, mockTextResponse, mockToolCallResponse } from '../llm/mock-llm.js';
import { TokenBudget, TokenBudgetExceededError } from '../llm/token-budget.js';
import { ReActLoop } from '../react/react-loop.js';
import type { ReActResult } from '../react/react-loop.js';
import { ToolRegistry, noopTool } from '../tools/tool-registry.js';
import { ToolAllowlist } from '../tools/tool-allowlist.js';

/** A loop wired with the `noop` tool registered (and allowed). */
function makeLoop(llm: MockLLM, budget: TokenBudget, maxSteps: number): ReActLoop {
  const tools = new ToolRegistry(new ToolAllowlist(new Set(['noop'])));
  tools.register(noopTool);
  return new ReActLoop(llm, tools, budget, maxSteps);
}

describe('ReActLoop', () => {
  it('returns the final answer on a first-turn end_turn with no steps', async () => {
    const llm = new MockLLM([mockTextResponse('done')]);
    const loop = makeLoop(llm, new TokenBudget(1000), 3);

    const result = await loop.run('system', 'go');

    expect(result.stopReason).toBe('end_turn');
    expect(result.finalAnswer).toBe('done');
    expect(result.steps).toEqual([]);
  });

  it('executes a tool call, feeds the observation back, and stops on the next end_turn', async () => {
    const llm = new MockLLM([
      mockToolCallResponse('noop', 'call-1', { a: 1 }),
      mockTextResponse('final'),
    ]);
    const loop = makeLoop(llm, new TokenBudget(1000), 3);

    const result = await loop.run('system', 'go');

    expect(result.stopReason).toBe('end_turn');
    expect(result.finalAnswer).toBe('final');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      stepNumber: 1,
      toolCall: { id: 'call-1', name: 'noop' },
      observation: 'ok',
    });
    // The tool result was appended as a user message for the second call.
    expect(llm.calls[1]?.messages).toHaveLength(3);
  });

  it('returns max_steps after exhausting every iteration', async () => {
    const llm = new MockLLM([
      mockToolCallResponse('noop', 'c1', {}),
      mockToolCallResponse('noop', 'c2', {}),
    ]);
    const loop = makeLoop(llm, new TokenBudget(1000), 2);

    const result: ReActResult = await loop.run('system', 'go');

    expect(result.stopReason).toBe('max_steps');
    expect(result.finalAnswer).toBe('');
    expect(result.steps).toHaveLength(2);
  });

  it('propagates TokenBudgetExceededError out of run', async () => {
    const llm = new MockLLM([mockTextResponse('x', 100, 0)]);
    const loop = makeLoop(llm, new TokenBudget(50), 3);

    await expect(loop.run('system', 'go')).rejects.toBeInstanceOf(TokenBudgetExceededError);
  });

  it('records a disallowed tool as a TOOL_NOT_ALLOWED observation and keeps looping', async () => {
    const llm = new MockLLM([
      mockToolCallResponse('nonexistent', 'c1', {}),
      mockTextResponse('recovered'),
    ]);
    const loop = makeLoop(llm, new TokenBudget(1000), 3);

    const result = await loop.run('system', 'go');

    expect(result.stopReason).toBe('end_turn');
    expect(result.finalAnswer).toBe('recovered');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.observation).toBe('TOOL_NOT_ALLOWED: nonexistent');
  });
});
