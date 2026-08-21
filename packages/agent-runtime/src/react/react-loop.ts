/**
 * `ReActLoop` (day-12 §2.2) — the Think → Tool Call → Observe cycle.
 *
 * The loop is deliberately small and opinionless: it alternates between asking
 * the {@link LLMProvider} for a response and executing any tool calls the model
 * requested, pushing each tool result back as a `user`-role message. It stops on
 * the first `end_turn` response, after `maxSteps` iterations, or when the
 * {@link TokenBudget} throws (which propagates — day-12 §3.7).
 *
 * `stopReason === 'tool_use'` with an empty `toolCalls` array is treated as
 * `end_turn` defensively (day-12 §3.3): a provider may flag a tool-reason
 * response that carries no actual call.
 */

import type { LLMMessage, LLMProvider, LLMToolCall } from '../llm/llm-provider.js';
import { TokenBudget } from '../llm/token-budget.js';
import type { ToolRegistry } from '../tools/tool-registry.js';

/** One iteration of the loop (day-12 §2.2). */
export interface ReActStep {
  /** 1-based iteration number. */
  readonly stepNumber: number;
  /** The model's reasoning/response text for this iteration. */
  readonly thought: string;
  /** The tool call the model requested, if any. */
  readonly toolCall?: LLMToolCall;
  /** The tool's observation (or error message), if a call was executed. */
  readonly observation?: string;
}

export interface ReActResult {
  readonly steps: ReActStep[];
  readonly finalAnswer: string;
  /**
   * Why the loop stopped. `token_budget` is reserved: a budget overrun throws
   * {@link import('../llm/token-budget.js').TokenBudgetExceededError} rather than
   * returning here (day-12 §3.7).
   */
  readonly stopReason: 'end_turn' | 'max_steps' | 'token_budget';
}

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

export class ReActLoop {
  constructor(
    private readonly llm: LLMProvider,
    private readonly tools: ToolRegistry,
    private readonly budget: TokenBudget,
    private readonly maxSteps: number,
  ) {}

  async run(systemPrompt: string, userMessage: string): Promise<ReActResult> {
    const messages: LLMMessage[] = [{ role: 'user', content: userMessage }];
    const steps: ReActStep[] = [];

    for (let i = 1; i <= this.maxSteps; i++) {
      const response = await this.llm.complete({
        model: MODEL,
        messages,
        maxTokens: MAX_TOKENS,
        systemPrompt,
        tools: this.tools.definitions(),
      });

      // Throws TokenBudgetExceededError when over — the loop lets it propagate.
      this.budget.consume(response.usage);

      if (response.stopReason === 'end_turn' || response.toolCalls.length === 0) {
        return { steps, finalAnswer: response.content, stopReason: 'end_turn' };
      }

      for (const call of response.toolCalls) {
        const observation = await this.execute(call);
        steps.push({ stepNumber: i, thought: response.content, toolCall: call, observation });
        messages.push(
          { role: 'assistant', content: response.content },
          { role: 'user', content: `[Tool result for ${call.name}]: ${observation}` },
        );
      }
    }

    return { steps, finalAnswer: '', stopReason: 'max_steps' };
  }

  /** Run one tool call, converting a thrown error into its observation (day-12 §3.7). */
  private async execute(call: LLMToolCall): Promise<string> {
    try {
      return await this.tools.execute(call);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}
