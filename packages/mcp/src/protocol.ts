/**
 * The Model Context Protocol wire types + hand-rolled validators.
 *
 * This package is deliberately host-agnostic: it knows nothing about GitHub,
 * GitLab, Bitbucket, or Jira. It speaks only the protocol — a JSON-RPC 2.0
 * envelope (`initialize` / `tools/list` / `tools/call`) carrying MCP's content
 * model (`ToolContent` / `ToolResult`). Host mapping lives in
 * `@harness/git-provider` / `@harness/ticket-provider` (Days 03–04).
 *
 * The codebase avoids a schema dependency (no Zod anywhere), so validation is
 * hand-rolled: a malformed server payload is a typed {@link McpClientError},
 * never a crash and never a silently-truncated `files: []`.
 */

import { McpClientError } from './errors.js';

// --- JSON-RPC 2.0 envelope -------------------------------------------------

/** A client → server request. */
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params?: unknown;
}

/** A server → client response to a request. */
export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

/** A JSON-RPC error object. */
export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

// --- MCP protocol surface --------------------------------------------------

/** The server descriptor returned by `initialize`. */
export interface ServerInfo {
  readonly name: string;
  readonly version: string;
  readonly capabilities?: Record<string, unknown>;
}

/** A discoverable tool returned by `tools/list`. */
export interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

/**
 * One content block inside a `ToolResult`. Mapped 1:1 from the protocol — never
 * flattened into a host's idea of a PR or issue (that is the provider's job).
 */
export type ToolContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string }
  | { readonly type: 'resource'; readonly resource: Record<string, unknown> };

/** The result of a `tools/call`. */
export interface ToolResult {
  readonly isError: boolean;
  readonly content: ToolContent[];
}

// --- Structural guards -----------------------------------------------------

/** Narrow an unknown to a plain record (object, not array, not null). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse the `initialize` result into a {@link ServerInfo}. The MCP spec wraps
 * the identifier the way a minimal reference server does: `{ serverInfo: { name,
 * version }, capabilities }`. Missing or malformed fields throw.
 */
export function parseServerInfo(raw: unknown): ServerInfo {
  if (!isRecord(raw)) {
    throw new McpClientError('initialize: result is not an object');
  }
  const info = raw['serverInfo'];
  if (!isRecord(info) || typeof info['name'] !== 'string' || typeof info['version'] !== 'string') {
    throw new McpClientError('initialize: result missing serverInfo.name/version');
  }
  const capabilities = isRecord(raw['capabilities']) ? raw['capabilities'] : undefined;
  return {
    name: info['name'],
    version: info['version'],
    ...(capabilities === undefined ? {} : { capabilities }),
  };
}

/** Parse the `tools/list` result into zero or more {@link McpTool}s. */
export function parseToolsList(raw: unknown): McpTool[] {
  if (!isRecord(raw) || !Array.isArray(raw['tools'])) {
    throw new McpClientError('tools/list: result missing tools[]');
  }
  return raw['tools'].map(parseTool);
}

function parseTool(v: unknown): McpTool {
  if (!isRecord(v) || typeof v['name'] !== 'string') {
    throw new McpClientError('tools/list: tool missing name');
  }
  const description = typeof v['description'] === 'string' ? v['description'] : undefined;
  const inputSchema = isRecord(v['inputSchema']) ? v['inputSchema'] : undefined;
  return {
    name: v['name'],
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
  };
}

/** Parse the `tools/call` result into a {@link ToolResult}. */
export function parseToolResult(raw: unknown): ToolResult {
  if (!isRecord(raw) || !Array.isArray(raw['content'])) {
    throw new McpClientError('tools/call: result missing content[]');
  }
  return {
    isError: raw['isError'] === true,
    content: raw['content'].map(parseToolContent),
  };
}

function parseToolContent(v: unknown): ToolContent {
  if (!isRecord(v)) {
    throw new McpClientError('tools/call: content block is not an object');
  }
  const type = v['type'];
  if (type === 'text') {
    if (typeof v['text'] !== 'string') {
      throw new McpClientError('tools/call: text content missing "text" string');
    }
    return { type: 'text', text: v['text'] };
  }
  if (type === 'image') {
    if (typeof v['data'] !== 'string' || typeof v['mimeType'] !== 'string') {
      throw new McpClientError('tools/call: image content missing data/mimeType');
    }
    return { type: 'image', data: v['data'], mimeType: v['mimeType'] };
  }
  if (type === 'resource') {
    if (!isRecord(v['resource'])) {
      throw new McpClientError('tools/call: resource content missing resource object');
    }
    return { type: 'resource', resource: v['resource'] };
  }
  throw new McpClientError(`tools/call: unknown content type "${String(type)}"`);
}
