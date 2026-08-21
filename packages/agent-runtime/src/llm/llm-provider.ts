/**
 * The `LLMProvider` abstraction (day-11 §2.1) — the single seam through which
 * every model call flows.
 *
 * Providers translate an {@link LLMRequest} into a provider-specific call and
 * return a normalised {@link LLMResponse}. Nothing outside
 * `packages/agent-runtime` knows which provider backed a call; the boundary
 * linter enforces that `@anthropic-ai/sdk` never leaks past this package.
 *
 * The shape is a minimal superset of what Anthropic and OpenAI both provide, so
 * a future `OpenAIProvider` (Phase 2) slots in without changing any caller.
 */

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  /** Model id, e.g. `'claude-sonnet-4-6'`. */
  model: string;
  messages: LLMMessage[];
  maxTokens: number;
  systemPrompt?: string;
  /** Tool definitions in Anthropic tool-use format. */
  tools?: LLMToolDefinition[];
  /**
   * Task lifecycle id (== tasks.id in Phase 1) — set by the ReActLoop so
   * `LoggingLLMProvider` records it into `llm_call_log.correlation_id`
   * (day-27 §2.2). Null only for calls made outside an agent run.
   */
  correlation_id?: string;
  /** The agent run making this call, for `llm_call_log.agent_run_id`. */
  agent_run_id?: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export interface LLMResponse {
  /** Raw text content blocks joined into one string. */
  content: string;
  /** Tool-use requests from the model, if any. */
  toolCalls: LLMToolCall[];
  /** Token usage, for budget tracking. */
  usage: { inputTokens: number; outputTokens: number };
  /** Provider stop reason: `'end_turn' | 'tool_use' | 'max_tokens' | ...`. */
  stopReason: string;
}

export interface LLMToolCall {
  /** Provider-assigned `tool_use` id. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMProvider {
  complete(request: LLMRequest): Promise<LLMResponse>;
}
