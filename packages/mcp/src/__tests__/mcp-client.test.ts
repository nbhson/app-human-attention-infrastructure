import { describe, expect, it } from 'vitest';

import { McpClientError } from '../errors.js';
import { McpClientImpl } from '../mcp-client.js';
import type { McpTransport } from '../transport.js';

interface InboundRequest {
  readonly id: number;
  readonly method: string;
  readonly params: { readonly arguments?: Record<string, unknown> };
}

/** Responds out-of-order: slower requests answer later, faster answer first. */
class OutOfOrderTransport implements McpTransport {
  private handler?: (m: unknown) => void;

  async start(): Promise<void> {}

  async send(message: unknown): Promise<void> {
    const req = message as InboundRequest;
    const args = req.params.arguments ?? {};
    const delay = typeof args['delay'] === 'number' ? args['delay'] : 0;
    const value = String(args['value'] ?? '');
    setTimeout(() => {
      this.handler?.({
        jsonrpc: '2.0',
        id: req.id,
        result: { isError: false, content: [{ type: 'text', text: value }] },
      });
    }, delay);
  }

  onMessage(handler: (m: unknown) => void): void {
    this.handler = handler;
  }

  onClose(): void {}

  async stop(): Promise<void> {}
}

/** Accepts requests but never answers — for the timeout test. */
class SilentTransport implements McpTransport {
  async start(): Promise<void> {}

  async send(): Promise<void> {}

  onMessage(): void {}

  onClose(): void {}

  async stop(): Promise<void> {}
}

describe('McpClient correlation', () => {
  it('matches responses to requests by id, not arrival order', async () => {
    const client = new McpClientImpl(new OutOfOrderTransport(), { timeoutMs: 1000 });
    const slow = client.callTool('a', { value: 'slow', delay: 50 });
    const fast = client.callTool('b', { value: 'fast', delay: 5 });

    await expect(fast).resolves.toEqual({
      isError: false,
      content: [{ type: 'text', text: 'fast' }],
    });
    await expect(slow).resolves.toEqual({
      isError: false,
      content: [{ type: 'text', text: 'slow' }],
    });
  });

  it('times out on a silent transport', async () => {
    const client = new McpClientImpl(new SilentTransport(), { timeoutMs: 30 });
    await expect(client.initialize()).rejects.toBeInstanceOf(McpClientError);
  });

  it('close is idempotent', async () => {
    const client = new McpClientImpl(new SilentTransport());
    await client.close();
    await client.close(); // must not throw
  });
});
