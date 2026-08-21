/**
 * `ToolRegistry` (day-12 §2.2 / §3.2) — the catalogue of tools an agent run may
 * invoke.
 *
 * The ReAct loop never knows *what* a tool does; it only asks the registry for
 * the list of {@link LLMToolDefinition}s to advertise to the model, then routes a
 * returned {@link LLMToolCall} back through {@link execute}. Tools are pure
 * string-in / string-out from the loop's perspective, which keeps the loop free
 * of any file-system or shell coupling (day-13 adds real tools behind the same
 * interface).
 *
 * An unknown tool name is an explicit error (`TOOL_NOT_FOUND`), not a silent
 * no-op. The ReAct loop treats that error as the tool's observation and keeps
 * looping, so a hallucinated call never kills the run.
 */

import type { LLMToolCall, LLMToolDefinition } from '../llm/llm-provider.js';

/** A callable tool (day-12 §3.2). `execute` returns its observation as text. */
export interface Tool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema describing the input (advertised to the model). */
  readonly inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<string>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

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

  /** Run a model-requested tool call, throwing `TOOL_NOT_FOUND` for unknown names. */
  async execute(call: LLMToolCall): Promise<string> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      throw new Error(`TOOL_NOT_FOUND: ${call.name}`);
    }
    return tool.execute(call.input);
  }
}

/**
 * The Phase-1 stand-in tool (day-12 §6). Always succeeds; replaced by real
 * `read_file`/`write_file`/`run_command` tools on Day 13. Kept as a standalone
 * value so bootstrap and tests register the same instance shape.
 */
export const noopTool: Tool = {
  name: 'noop',
  description: 'A stand-in tool that does nothing and reports success.',
  inputSchema: { type: 'object', properties: {} },
  async execute(): Promise<string> {
    return 'ok';
  },
};
