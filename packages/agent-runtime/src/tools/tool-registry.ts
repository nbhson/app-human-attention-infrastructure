/**
 * `ToolRegistry` (day-12 §2.2 / §3.2) — the catalogue of tools an agent run may
 * invoke.
 *
 * The ReAct loop never knows *what* a tool does; it only asks the registry for
 * the list of {@link LLMToolDefinition}s to advertise to the model, then routes a
 * returned {@link LLMToolCall} back through {@link execute}. Tools are pure
 * string-in / string-out from the loop's perspective, which keeps the loop free
 * of any file-system or shell coupling.
 *
 * Day 13 adds two gates to the same interface:
 * - a {@link ToolAllowlist}, checked before dispatch (unknown *and* forbidden
 *   tools both refuse; the loop logs the message and keeps running), and
 * - a {@link ToolExecutionContext}, threaded through `execute`, that carries the
 *   invoking {@link AgentRunID} and the {@link IEventBus} so `write_file` can
 *   emit `artifact.created` without importing the Tracker.
 */

import type { AgentRunID, CorrelationID } from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';

import type { LLMToolCall, LLMToolDefinition } from '../llm/llm-provider.js';
import { ToolAllowlist } from './tool-allowlist.js';

/** Ambient state a tool may read while executing (day-13 §3.4). */
export interface ToolExecutionContext {
  /** The agent run invoking the tool (absent for standalone/noop use). */
  readonly agentRunId?: AgentRunID;
  /** The task lifecycle id (== correlation id) the run belongs to (day-27 §2.2). */
  readonly correlationId?: CorrelationID;
  /** The event bus, for tools that emit domain events (write_file → artifact.created). */
  readonly bus?: IEventBus;
}

/** A callable tool (day-12 §3.2). `execute` returns its observation as text. */
export interface Tool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema describing the input (advertised to the model). */
  readonly inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(
    private readonly allowlist: ToolAllowlist,
    private readonly bus?: IEventBus,
  ) {}

  /** Add (or replace) a tool, keyed by its name. */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** The model-facing definitions of every registered tool (empty when none). */
  definitions(): LLMToolDefinition[] {
    return [...this.tools.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  /**
   * Run a model-requested tool call. Throws `TOOL_NOT_ALLOWED` for a forbidden
   * name and `TOOL_NOT_FOUND` for an unregistered one; both become the tool's
   * observation in the loop rather than killing the run.
   */
  async execute(
    call: LLMToolCall,
    agentRunId?: AgentRunID,
    correlationId?: CorrelationID,
  ): Promise<string> {
    this.allowlist.assertAllowed(call.name);
    const tool = this.tools.get(call.name);
    if (!tool) {
      throw new Error(`TOOL_NOT_FOUND: ${call.name}`);
    }
    const ctx: ToolExecutionContext = {
      ...(agentRunId !== undefined ? { agentRunId } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(this.bus !== undefined ? { bus: this.bus } : {}),
    };
    return tool.execute(call.input, ctx);
  }
}

/**
 * The Phase-1 stand-in tool (day-12 §6). Always succeeds; replaced by real
 * `read_file`/`write_file`/`list_directory` tools on Day 13. Kept as a standalone
 * value so tests can register the same instance shape without a file system.
 */
export const noopTool: Tool = {
  name: 'noop',
  description: 'A stand-in tool that does nothing and reports success.',
  inputSchema: { type: 'object', properties: {} },
  async execute(): Promise<string> {
    return 'ok';
  },
};
