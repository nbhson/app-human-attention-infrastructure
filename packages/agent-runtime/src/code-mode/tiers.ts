/**
 * Tool tiers for sandboxed Code Mode (day-23 §2.2 / Spec 3 §14.1).
 *
 * A tool's tier is a *construction-time* capability gate, not a runtime `if`:
 * tier is mapped to the sandbox mount mode (`workspaceWritable`), so a tier-0
 * tool runs with a read-only workspace while a tier-1 tool gets the single
 * writable workspace mount. Tier 2 adds an *auth* gate on top — OPERATOR
 * approval — and is refused (not merely logged) when absent.
 */

/** 0 = read-only, 1 = constrained write to the workspace, 2 = auth-gated. */
export type ToolTier = 0 | 1 | 2;

/** The default tier assignment for every sandboxed tool (day-23 §2.2 table). */
export const DEFAULT_TOOL_TIERS: Readonly<Record<string, ToolTier>> = {
  // Tier 0 — read-only: no write tool reachable.
  read_file: 0,
  list_directory: 0,
  ls: 0,
  grep: 0,
  // Tier 1 — constrained write: writes land only in the workspace mount.
  write_file: 1,
  run_test: 1,
  // Tier 2 — auth-gated: arbitrary command / remote push need OPERATOR approval.
  run_command: 2,
  git_push: 2,
};

/** Resolve a tool's tier; throws for an unknown tool name. */
export function tierOf(tool: string): ToolTier {
  const tier = DEFAULT_TOOL_TIERS[tool];
  if (tier === undefined) {
    throw new Error(`UNKNOWN_TOOL_TIER: ${tool}`);
  }
  return tier;
}

/** Whether the tool's tier maps to a writable workspace mount (tier 1+). */
export function writesWorkspace(tool: string): boolean {
  return tierOf(tool) >= 1;
}

/** Thrown when a tier-2 tool is invoked without OPERATOR approval. */
export class ToolApprovalRequiredError extends Error {
  override readonly name = 'ToolApprovalRequiredError';

  constructor(readonly tool: string) {
    super(`${tool} requires OPERATOR approval before it can run`);
  }
}

/**
 * Refuse a tier-2 tool unless approval was granted. This is the "ejector seat"
 * (day-23 §6): the unapproved path throws so it can be surfaced to the
 * orchestrator, not silently logged and allowed.
 */
export function assertTierAllowed(tool: string, approved: boolean): void {
  if (tierOf(tool) === 2 && !approved) {
    throw new ToolApprovalRequiredError(tool);
  }
}
