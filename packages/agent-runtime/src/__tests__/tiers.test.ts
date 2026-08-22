/**
 * day-23 §2.2 — tool tiers and the tier-2 auth gate.
 *
 * Tier is a *capability* table, not a runtime branch: tier 0 tools are
 * read-only, tier 1 tools write only to the workspace mount, tier 2 tools
 * require OPERATOR approval. The gate (`assertTierAllowed`) must refuse — not
 * merely log — an unapproved tier-2 tool.
 */

import { describe, expect, it } from 'vitest';

import {
  assertTierAllowed,
  DEFAULT_TOOL_TIERS,
  tierOf,
  ToolApprovalRequiredError,
  writesWorkspace,
} from '../code-mode/tiers.js';

describe('tool tiers', () => {
  it('assigns read-only tools to tier 0', () => {
    expect(tierOf('read_file')).toBe(0);
    expect(tierOf('list_directory')).toBe(0);
    expect(tierOf('grep')).toBe(0);
  });

  it('assigns constrained-write tools to tier 1', () => {
    expect(tierOf('write_file')).toBe(1);
    expect(tierOf('run_test')).toBe(1);
  });

  it('assigns auth-gated tools to tier 2', () => {
    expect(tierOf('run_command')).toBe(2);
    expect(tierOf('git_push')).toBe(2);
  });

  it('throws for an unknown tool name', () => {
    expect(() => tierOf('rm_rf_home')).toThrow(/UNKNOWN_TOOL_TIER/);
  });

  it('writesWorkspace is true exactly for tier 1+', () => {
    expect(writesWorkspace('read_file')).toBe(false);
    expect(writesWorkspace('grep')).toBe(false);
    expect(writesWorkspace('write_file')).toBe(true);
    expect(writesWorkspace('run_command')).toBe(true);
  });

  it('refuses an unapproved tier-2 tool', () => {
    expect(() => assertTierAllowed('run_command', false)).toThrow(ToolApprovalRequiredError);
  });

  it('allows an approved tier-2 tool', () => {
    expect(() => assertTierAllowed('run_command', true)).not.toThrow();
  });

  it('never gates tier 0/1 tools on approval', () => {
    expect(() => assertTierAllowed('read_file', false)).not.toThrow();
    expect(() => assertTierAllowed('write_file', false)).not.toThrow();
  });

  it('names the tool in the refusal', () => {
    try {
      assertTierAllowed('git_push', false);
      throw new Error('expected ToolApprovalRequiredError');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolApprovalRequiredError);
      expect((err as ToolApprovalRequiredError).tool).toBe('git_push');
    }
  });

  it('keeps the default tiers consistent with the pmapped policy', () => {
    // The `tiers` table is the single source of truth for the tier↔mount map.
    expect(DEFAULT_TOOL_TIERS['write_file']).toBe(1);
    expect(DEFAULT_TOOL_TIERS['read_file']).toBe(0);
  });
});
