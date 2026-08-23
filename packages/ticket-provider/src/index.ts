/**
 * `@harness/ticket-provider` — the ticket-system read seam (review-reorient
 * Phase 3).
 *
 * Public surface:
 * - `ticket-provider` — the `TicketProvider` interface, `FetchIssueInput`,
 *   `TicketProviderError`.
 * - `jira-provider` — `JiraProvider` (Cloud REST over `fetch`).
 * - `jira-mapper` — the pure `mapJiraIssue` + `adfToPlainText` (fixtures-testable).
 * - `ticket-tool-map` — the per-system capability→tool-name table (`TicketToolMap`,
 *   `StaticTicketToolMap`).
 * - `mcp-ticket-mapper` — `mapMcpTicketIssue` (ToolContent[] → `Issue`).
 * - `mcp-ticket-provider` — `MCPTicketProvider` (fetch via MCP tools) + the
 *   `UnknownTicketSystemError` for an unconfigured system.
 */

export * from './ticket-provider.js';
export * from './jira-provider.js';
export * from './jira-mapper.js';
export * from './ticket-tool-map.js';
export * from './mcp-ticket-mapper.js';
export * from './mcp-ticket-provider.js';
