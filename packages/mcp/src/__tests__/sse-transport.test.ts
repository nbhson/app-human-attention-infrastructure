import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { McpClientImpl } from '../mcp-client.js';
import { SseTransport } from '../transport.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/sse') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write('event: endpoint\ndata: /message\n\n');
      return; // keep the stream open until the transport stops it
    }
    if (req.url === '/message' && req.method === 'POST') {
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString('utf8');
      });
      req.on('end', () => {
        const msg = JSON.parse(body) as { id: number; method: string };
        let result: unknown;
        if (msg.method === 'initialize') {
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'sse-fixture', version: '1.0.0' },
          };
        } else if (msg.method === 'tools/call') {
          result = { isError: false, content: [{ type: 'text', text: 'pong' }] };
        } else {
          result = { tools: [] };
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterEach(() => {
  server.closeAllConnections?.();
});

describe('SseTransport', () => {
  it('initialize + callTool over HTTP-with-SSE', async () => {
    const transport = new SseTransport({ url: `${baseUrl}/sse` });
    await transport.start();
    const client = new McpClientImpl(transport, { timeoutMs: 2000 });
    try {
      const info = await client.initialize();
      expect(info).toEqual({ name: 'sse-fixture', version: '1.0.0', capabilities: {} });

      const result = await client.callTool('ping', {});
      expect(result).toEqual({ isError: false, content: [{ type: 'text', text: 'pong' }] });
    } finally {
      await client.close();
    }
  });
});
