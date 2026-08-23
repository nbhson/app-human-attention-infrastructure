/**
 * `TicketToolMap` — the capability→tool-name binding that makes "add a ticket
 * system" a single table entry instead of a REST adapter (Phase 3 day-04).
 *
 * Where `GitToolMap` binds three forges, this table binds ticket systems — Jira
 * first. Jira MCP servers name the same capabilities differently (`get_issue` vs
 * `jira_get_issue`, `add_comment` vs `create_comment`, `transition_issue` vs
 * `move_issue`) and take different argument keys (`issue_id_or_key` vs `key`,
 * `target_status` vs `status`). This map is the *only* place that variance lives;
 * {@link MCPTicketProvider} never special-cases a tool string itself (day-04 §2).
 */

import { TicketProviderType } from '@harness/domain';

import { TicketProviderError } from './ticket-provider.js';

/** A ticket system this package can route to (the MCP server name in `mcp.config.json`). */
export type TicketSystem = TicketProviderType;

/** The read + write capabilities the ticket path needs, mapped to a system's tool names. */
export interface ResolvedTicketTools {
  readonly getIssueTool: string;
  readonly commentTool: string;
  readonly transitionTool: string;
}

/** One system's row: its tool names and its arg shapes. */
export interface TicketToolMapEntry {
  readonly system: TicketSystem;
  readonly getIssueTool: string;
  readonly commentTool: string;
  readonly transitionTool: string;
  /** Translate an issue key into that system's get-issue arguments. */
  readonly buildArgs: (input: { key: string }) => Record<string, unknown>;
  /** Translate an issue key + comment body into that system's comment arguments. */
  readonly buildCommentArgs: (input: { key: string; body: string }) => Record<string, unknown>;
  /** Translate an issue key + target status into that system's transition arguments. */
  readonly buildTransitionArgs: (input: {
    key: string;
    targetState: string;
  }) => Record<string, unknown>;
}

/**
 * The per-system tool-name/arg-encoding table behind {@link MCPTicketProvider}.
 *
 * Exposed as an interface so a test can inject a single-row table; `StaticTicketToolMap`
 * is the production default.
 */
export interface TicketToolMap {
  /** The tool names for a system (throws if the system has no entry). */
  resolve(system: TicketSystem): ResolvedTicketTools;
  /** The get-issue argument object for a system (throws if the system has no entry). */
  buildArgs(system: TicketSystem, input: { key: string }): Record<string, unknown>;
  /** The comment argument object for a system (throws if the system has no entry). */
  buildCommentArgs(
    system: TicketSystem,
    input: { key: string; body: string },
  ): Record<string, unknown>;
  /** The transition argument object for a system (throws if the system has no entry). */
  buildTransitionArgs(
    system: TicketSystem,
    input: { key: string; targetState: string },
  ): Record<string, unknown>;
}

/** The built-in row for the single public ticket system. */
export const DEFAULT_TICKET_TOOL_MAP: readonly TicketToolMapEntry[] = [
  {
    system: TicketProviderType.Jira,
    getIssueTool: 'get_issue',
    commentTool: 'add_comment',
    transitionTool: 'transition_issue',
    buildArgs: ({ key }) => ({ issue_id_or_key: key }),
    buildCommentArgs: ({ key, body }) => ({ issue_id_or_key: key, body }),
    buildTransitionArgs: ({ key, targetState }) => ({
      issue_id_or_key: key,
      target_status: targetState,
    }),
  },
];

/** The production {@link TicketToolMap} over {@link DEFAULT_TICKET_TOOL_MAP}. */
export class StaticTicketToolMap implements TicketToolMap {
  private readonly bySystem = new Map<TicketSystem, TicketToolMapEntry>();

  constructor(entries: readonly TicketToolMapEntry[] = DEFAULT_TICKET_TOOL_MAP) {
    for (const entry of entries) {
      this.bySystem.set(entry.system, entry);
    }
  }

  resolve(system: TicketSystem): ResolvedTicketTools {
    const entry = this.require(system);
    return {
      getIssueTool: entry.getIssueTool,
      commentTool: entry.commentTool,
      transitionTool: entry.transitionTool,
    };
  }

  buildArgs(system: TicketSystem, input: { key: string }): Record<string, unknown> {
    return this.require(system).buildArgs(input);
  }

  buildCommentArgs(
    system: TicketSystem,
    input: { key: string; body: string },
  ): Record<string, unknown> {
    return this.require(system).buildCommentArgs(input);
  }

  buildTransitionArgs(
    system: TicketSystem,
    input: { key: string; targetState: string },
  ): Record<string, unknown> {
    return this.require(system).buildTransitionArgs(input);
  }

  private require(system: TicketSystem): TicketToolMapEntry {
    const entry = this.bySystem.get(system);
    if (entry === undefined) {
      throw new TicketProviderError(`no ticket tool map entry for system "${system}"`);
    }
    return entry;
  }
}
