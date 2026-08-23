/**
 * The `LLMProvider` abstraction — the single seam through which every model call
 * flows (day-11 §2.1, relocated to `@harness/domain` day-21 §2.4).
 *
 * Providers translate an {@link LLMRequest} into a provider-specific call and
 * return a normalised {@link LLMResponse}. Originally these types lived in
 * `@harness/agent-runtime`, but the review-quality judge (`@harness/judge`) must
 * call the same seam without importing a sibling *engine* (boundary R4). The
 * seam is a pure contract — no behaviour, no provider-specific SDK — so it
 * belongs here in `@harness/domain`, exactly as `MemoryProvider` does.
 * `@harness/agent-runtime` re-exports these from `llm/llm-provider.ts` so its
 * public surface (and `@anthropic-ai/sdk` containment) is unchanged.
 *
 * The shape is a minimal superset of what Anthropic and OpenAI both provide, so
 * a new `OpenAICompatibleProvider` (Phase 3) slots in without changing any caller.
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
