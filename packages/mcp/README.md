# @harness/mcp — Generic Model Context Protocol Client

The **one client** the harness uses to reach Git hosts (GitHub/GitLab/Bitbucket)
and ticket systems (Jira). It speaks only the protocol — `initialize`,
`tools/list`, `tools/call` over JSON-RPC 2.0 — and knows nothing about PRs, MRs,
or issues. The internet ships the MCP servers; we ship the client + a config
file, not per-provider REST adapters.

**Status:** as-built ·
**Boundary rule:** a leaf protocol package — depends on nothing but `@harness/domain`.

---

## Modules

| Module | Purpose |
|--------|---------|
| `errors.ts` | `McpClientError` — the single typed failure all callers match on. |
| `protocol.ts` | JSON-RPC envelope + MCP content model (`ToolContent`, `ToolResult`, `McpTool`, `ServerInfo`) and hand-rolled validators. |
| `transport.ts` | `McpTransport` seam + `StdioTransport` (subprocess, JSON-lines) + `SseTransport` (HTTP with SSE). |
| `mcp-client.ts` | `McpClient` — `initialize`/`listTools`/`callTool`/`close`, with id-correlated request/response and a per-request timeout. |

## Invariants

- **No host symbols.** If `github` / `gitlab` / `bitbucket` / `jira` appears here,
  the abstraction leaked — host mapping belongs in `@harness/git-provider` /
  `@harness/ticket-provider`.
- **No credentials.** The client never caches or logs a token; credentials are
  env vars for the *server subprocess* (stdio) or request headers the caller
  injects (SSE).
- **Malformed input is a typed error, never a crash or a silent truncation.**