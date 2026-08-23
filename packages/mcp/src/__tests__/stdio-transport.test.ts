import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { McpClientError } from '../errors.js';
import { McpClientImpl } from '../mcp-client.js';
import { StdioTransport } from '../transport.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/stdio-server.mjs', import.meta.url));

async function withClient(args: string[] = [], timeoutMs = 2000): Promise<McpClientImpl> {
  const transport = new StdioTransport({ command: process.execPath, args: [FIXTURE, ...args] });
  await transport.start();
  return new McpClientImpl(transport, { timeoutMs });
}

describe('StdioTransport', () => {
  it('initialize → listTools → callTool over a real subprocess', async () => {
    const client = await withClient();
    try {
      const info = await client.initialize();
      expect(info).toEqual({ name: 'fixture', version: '1.0.0', capabilities: {} });

      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['echo']);

      const result = await client.callTool('echo', { a: 1 });
      expect(result).toEqual({ isError: false, content: [{ type: 'text', text: 'echo:{"a":1}' }] });
    } finally {
      await client.close();
    }
  });

  it('drops a malformed (non-JSON) stdout line', async () => {
    const client = await withClient(['--garbage']);
    try {
      const tools = await client.listTools();
      expect(tools).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it('surfaces a server exit mid-call as McpClientError', async () => {
    const client = await withClient(['--exit-on-initialize']);
    await expect(client.initialize()).rejects.toBeInstanceOf(McpClientError);
  });
});
