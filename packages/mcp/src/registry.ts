/**
 * {@link McpServerRegistry} — turns the parsed {@link McpConfig} into a set of
 * connected clients, one per server, lazy-started and shared for the process
 * lifetime. `closeAll()` tears down every spawned subprocess at shutdown.
 *
 * The registry holds no secrets: an SSE server's token is read transiently at
 * connect time from the env var its entry names and used only to build the
 * `Authorization` header (the "header injector" — Day 02 §2.1). stdio servers
 * inherit `process.env` through the spawned subprocess and need no re-injection.
 */

import type { McpConfig, McpServerEntry } from './config.js';
import { McpConfigError } from './config.js';
import { McpClientImpl } from './mcp-client.js';
import type { McpClient } from './mcp-client.js';
import { SseTransport, StdioTransport } from './transport.js';
import type { McpTransport } from './transport.js';

/** Hands out a connected client per configured server. */
export interface McpServerRegistry {
  /** Lazy-start (and share thereafter) the client for `name`. */
  get(name: string): Promise<McpClient>;
  /** The validated entries (names + transports + token hints). */
  entries(): readonly McpServerEntry[];
  /** The configured server names. */
  list(): string[];
  /** Shut down every started client / subprocess. */
  closeAll(): Promise<void>;
}

export class McpServerRegistryImpl implements McpServerRegistry {
  private readonly clients = new Map<string, McpClient>();

  constructor(
    private readonly config: McpConfig,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  async get(name: string): Promise<McpClient> {
    const existing = this.clients.get(name);
    if (existing) {
      return existing;
    }
    const entry = this.config.servers.find((s) => s.name === name);
    if (!entry) {
      throw new McpConfigError(`no MCP server configured for "${name}"`);
    }
    const transport = buildTransport(entry, this.env);
    await transport.start();
    const client = new McpClientImpl(transport);
    this.clients.set(name, client);
    return client;
  }

  entries(): readonly McpServerEntry[] {
    return this.config.servers;
  }

  list(): string[] {
    return this.config.servers.map((s) => s.name);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
  }
}

function buildTransport(entry: McpServerEntry, env: Record<string, string | undefined>): McpTransport {
  if (entry.transport === 'stdio') {
    return new StdioTransport({
      command: entry.command!,
      ...(entry.args === undefined ? {} : { args: entry.args }),
    });
  }
  const headers = buildSseHeaders(entry, env);
  return new SseTransport({
    url: entry.url!,
    ...(headers === undefined ? {} : { headers }),
  });
}

function buildSseHeaders(
  entry: McpServerEntry,
  env: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(entry.headers ?? {}) };
  if (entry.tokenEnv) {
    const value = env[entry.tokenEnv];
    if (value !== undefined && value.length > 0 && !('authorization' in headers) && !('Authorization' in headers)) {
      // The only legitimate place a token value is read: injected into the
      // Authorization header at connect time, never cached, never logged.
      headers['authorization'] = `Bearer ${value}`;
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}
