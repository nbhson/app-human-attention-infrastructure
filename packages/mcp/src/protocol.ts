/**
 * The Model Context Protocol wire types + Zod schemas.
 *
 * This package is deliberately host-agnostic: it knows nothing about GitHub,
 * GitLab, Bitbucket, or Jira. It speaks only the protocol — a JSON-RPC 2.0
 * envelope (`initialize` / `tools/list` / `tools/call`) carrying MCP's content
 * model (`ToolContent` / `ToolResult`). Host mapping lives in
 * `@harness/git-provider` / `@harness/ticket-provider` (Days 03–04).
 *
 * Zod schemas double as both runtime validation and static TypeScript types
 * (`z.infer<>`), so the protocol surface is enforced in one place rather than
 * duplicated across hand-rolled type guards. A malformed server payload is a
 * typed {@link McpClientError}, never a crash and never a silently-truncated
 * `files: []`.
 */

import { z } from 'zod';
import { McpClientError } from './errors.js';

// --- JSON-RPC 2.0 envelope -------------------------------------------------

/** A JSON-RPC error object. */
export const JsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;

/** A client → server request. */
export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]),
  method: z.string(),
  params: z.unknown().optional(),
});

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

/** A server → client response to a request. */
export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: JsonRpcErrorSchema.optional(),
});

export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

// --- MCP protocol surface --------------------------------------------------

/** The server descriptor returned by `initialize`. */
export const ServerInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

export type ServerInfo = z.infer<typeof ServerInfoSchema>;

/** A discoverable tool returned by `tools/list`. */
export const McpToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});

export type McpTool = z.infer<typeof McpToolSchema>;

/**
 * One content block inside a `ToolResult`. Mapped 1:1 from the protocol — never
 * flattened into a host's idea of a PR or issue (that is the provider's job).
 */
export const ToolContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
  z.object({ type: z.literal('resource'), resource: z.record(z.string(), z.unknown()) }),
]);

export type ToolContent = z.infer<typeof ToolContentSchema>;

/** The result of a `tools/call`. */
export const ToolResultSchema = z.object({
  isError: z.boolean().default(false),
  content: z.array(ToolContentSchema),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

// --- Structural guards -----------------------------------------------------

// The raw `initialize` result wraps the identifier the way a minimal reference
// server does: `{ serverInfo: { name, version }, capabilities }`.
const InitializeResultSchema = z.object({
  serverInfo: ServerInfoSchema,
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Parse the `initialize` result into a {@link ServerInfo}. The MCP spec wraps
 * the identifier the way a minimal reference server does: `{ serverInfo: { name,
 * version }, capabilities }`. Missing or malformed fields throw.
 */
export function parseServerInfo(raw: unknown): ServerInfo {
  const parsed = InitializeResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new McpClientError('initialize: result missing serverInfo.name/version');
  }
  const { serverInfo, capabilities } = parsed.data;
  return {
    ...serverInfo,
    ...(capabilities === undefined ? {} : { capabilities }),
  };
}

/** Parse the `tools/list` result into zero or more {@link McpTool}s. */
export function parseToolsList(raw: unknown): McpTool[] {
  const parsed = z.object({ tools: z.array(McpToolSchema) }).safeParse(raw);
  if (!parsed.success) {
    throw new McpClientError('tools/list: result missing tools[]');
  }
  return parsed.data.tools;
}

/** Parse the `tools/call` result into a {@link ToolResult}. */
export function parseToolResult(raw: unknown): ToolResult {
  const parsed = ToolResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new McpClientError('tools/call: result missing content[]');
  }
  return parsed.data;
}
