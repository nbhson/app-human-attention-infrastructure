import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { McpConfigError, parseMcpConfig } from '../config.js';
import { McpServerRegistryImpl } from '../registry.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/stdio-server.mjs', import.meta.url));

function stdioConfig(name: string): ReturnType<typeof parseMcpConfig> {
  return parseMcpConfig(
    JSON.stringify({
      servers: {
        [name]: { transport: 'stdio', command: process.execPath, args: [FIXTURE] },
      },
    }),
    {},
  );
}

describe('McpServerRegistry', () => {
  it('shares one client per server and still works after closeAll', async () => {
    const registry = new McpServerRegistryImpl(stdioConfig('fixture'));

    expect(registry.list()).toEqual(['fixture']);

    const first = await registry.get('fixture');
    const second = await registry.get('fixture');
    expect(first).toBe(second);

    const tools = await first.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo']);

    await registry.closeAll();

    // After cleanup, a fresh get() re-spawns a working client.
    const reconnected = await registry.get('fixture');
    expect(reconnected).not.toBe(first);
    expect(await reconnected.listTools()).toHaveLength(1);

    await registry.closeAll();
  });

  it('rejects an unconfigured server name', async () => {
    const registry = new McpServerRegistryImpl(stdioConfig('fixture'));
    await expect(registry.get('missing')).rejects.toBeInstanceOf(McpConfigError);
  });

  it('closeAll is idempotent', async () => {
    const registry = new McpServerRegistryImpl(stdioConfig('fixture'));
    await registry.closeAll();
    await registry.closeAll();
  });
});
