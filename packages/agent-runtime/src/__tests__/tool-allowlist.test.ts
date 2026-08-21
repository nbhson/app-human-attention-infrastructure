import { describe, expect, it } from 'vitest';

import { ToolAllowlist } from '../tools/tool-allowlist.js';
import { ToolRegistry, noopTool } from '../tools/tool-registry.js';

describe('ToolAllowlist', () => {
  it('allows an explicitly permitted tool', () => {
    const allowlist = new ToolAllowlist(new Set(['read_file']));
    expect(() => allowlist.assertAllowed('read_file')).not.toThrow();
  });

  it('throws TOOL_NOT_ALLOWED for a tool not on the list', () => {
    const allowlist = new ToolAllowlist(new Set(['read_file']));
    expect(() => allowlist.assertAllowed('write_file')).toThrow('TOOL_NOT_ALLOWED: write_file');
  });
});

describe('ToolRegistry (allowlist-gated)', () => {
  it('executes an allowed tool', async () => {
    const registry = new ToolRegistry(new ToolAllowlist(new Set(['noop'])));
    registry.register(noopTool);

    await expect(registry.execute({ id: 'c1', name: 'noop', input: {} })).resolves.toBe('ok');
  });

  it('refuses a disallowed tool with TOOL_NOT_ALLOWED', async () => {
    const registry = new ToolRegistry(new ToolAllowlist(new Set()));
    registry.register(noopTool);

    await expect(registry.execute({ id: 'c1', name: 'noop', input: {} })).rejects.toThrow(
      'TOOL_NOT_ALLOWED: noop',
    );
  });

  it('still throws TOOL_NOT_FOUND for an allowed-but-unregistered name', async () => {
    const registry = new ToolRegistry(new ToolAllowlist(new Set(['ghost'])));

    await expect(registry.execute({ id: 'c1', name: 'ghost', input: {} })).rejects.toThrow(
      'TOOL_NOT_FOUND: ghost',
    );
  });
});
