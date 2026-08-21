/**
 * `ToolAllowlist` (day-13 §2.2 / §3.4) — the gate between the model and tool
 * execution.
 *
 * Tools are *registered* on the {@link import('./tool-registry.js').ToolRegistry}
 * but only *callable* when their name is explicitly permitted here. The list is
 * built from `AGENT_ALLOWED_TOOLS` in bootstrap, so every environment can lock
 * down the subset of tools an agent may actually invoke — the registry itself
 * stays unaware of policy.
 */

/** The set of tool names the agent is permitted to call. */
export class ToolAllowlist {
  constructor(private readonly allowed: ReadonlySet<string>) {}

  /** Throw `TOOL_NOT_ALLOWED` unless `toolName` is explicitly permitted. */
  assertAllowed(toolName: string): void {
    if (!this.allowed.has(toolName)) {
      throw new Error(`TOOL_NOT_ALLOWED: ${toolName}`);
    }
  }
}
