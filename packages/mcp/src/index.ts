/**
 * `@harness/mcp` — the generic Model Context Protocol client.
 *
 * Host-agnostic and transport-agnostic: this package ships *one* client over
 * two transports (`stdio` subprocess + SSE/HTTP) and knows nothing about GitHub,
 * GitLab, Bitbucket, or Jira. Adding a host is a `mcp.config.json` entry (Day
 * 02), never a new adapter here.
 *
 * Public surface:
 * - `errors` — {@link McpClientError}.
 * - `protocol` — JSON-RPC + MCP content types (`ToolResult`, `ToolContent`,
 *   `McpTool`, `ServerInfo`) and their hand-rolled validators.
 * - `transport` — {@link McpTransport} + `StdioTransport` + `SseTransport`.
 * - `mcp-client` — {@link McpClient} / {@link McpClientImpl}.
 */

export * from './errors.js';
export * from './protocol.js';
export * from './transport.js';
export * from './mcp-client.js';
