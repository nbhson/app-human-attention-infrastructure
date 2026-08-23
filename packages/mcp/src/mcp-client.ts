/**
 * {@link McpClient} — the protocol head over an {@link McpTransport}.
 *
 * Owns the JSON-RPC request/response correlation that makes `tools/call`
 * safe to issue concurrently: every request gets a monotonically-increasing id,
 * the pending waiter is stored, and inbound responses are routed by id. A
 * per-request wall-clock timeout (default 30s) guarantees a server that never
 * answers surfaces as a typed {@link McpClientError}, not a hang.
 */

import { McpClientError } from './errors.js';
import { parseServerInfo, parseToolResult, parseToolsList } from './protocol.js';
import type { McpTool, ServerInfo, ToolResult } from './protocol.js';
import type { McpTransport } from './transport.js';

export interface McpClientOptions {
  /** Per-request wall-clock timeout, ms. Default 30_000. */
  readonly timeoutMs?: number;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (err: unknown) => void;
  readonly timer: NodeJS.Timeout;
}

/** The generic MCP client the rest of the harness calls into. */
export interface McpClient {
  initialize(): Promise<ServerInfo>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

export class McpClientImpl implements McpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private closed = false;

  private readonly timeoutMs: number;

  constructor(
    private readonly transport: McpTransport,
    options: McpClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.transport.onMessage((m) => this.handleMessage(m));
    this.transport.onClose((err) => this.handleClose(err));
  }

  async initialize(): Promise<ServerInfo> {
    const raw = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'harness', version: '0.3.0' },
    });
    return parseServerInfo(raw);
  }

  async listTools(): Promise<McpTool[]> {
    const raw = await this.request('tools/list', {});
    return parseToolsList(raw);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const raw = await this.request('tools/call', { name, arguments: args });
    return parseToolResult(raw);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectAllPending(new McpClientError('client closed'));
    await this.transport.stop();
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new McpClientError('client closed'));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpClientError(`request "${method}" timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send({ jsonrpc: '2.0', id, method, params }).catch((err: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  private handleMessage(m: unknown): void {
    if (typeof m !== 'object' || m === null) {
      return;
    }
    const record = m as Record<string, unknown>;
    const rawId = record['id'];
    if (
      (typeof rawId === 'number' || typeof rawId === 'string') &&
      ('result' in record || 'error' in record)
    ) {
      const id = typeof rawId === 'number' ? rawId : Number(rawId);
      const entry = this.pending.get(id);
      if (!entry) {
        return;
      }
      clearTimeout(entry.timer);
      this.pending.delete(id);
      if ('error' in record && record['error'] !== undefined) {
        entry.reject(new McpClientError(`server error: ${JSON.stringify(record['error'])}`));
      } else {
        entry.resolve(record['result']);
      }
    }
    // Server → client requests and notifications are unsupported by this basic
    // client and are ignored.
  }

  private handleClose(err?: Error): void {
    if (this.closed) {
      return;
    }
    this.rejectAllPending(err ?? new McpClientError('transport closed'));
  }

  private rejectAllPending(err: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }
}
