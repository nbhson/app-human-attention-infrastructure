# Day 01 — `@harness/mcp`: Generic MCP Client (stdio + SSE/HTTP)

| | |
|---|---|
| **Week** | 1 — MCP connectivity |
| **Spec refs** | Phase-3 README §3 (MCP client), §4 (`@harness/mcp`); Architecture §7 (boundary rule) |
| **Estimated effort** | 7h |
| **Prerequisites** | Phase 2 complete (`v0.2.0-harness`); `GitProvider` / `TicketProvider` seams ship in Phase 1 |

---

## 1. Objectives

By end of day you will have:

1. A new `@harness/mcp` package hosting a **generic Model Context Protocol client** — host-agnostic, transport-agnostic, no GitHub/GitLab/Bitbucket/Jira knowledge.
2. Two transports: **stdio** (spawn the server as a subprocess, speak newline-delimited JSON-RPC) and **SSE/HTTP** (connect to a remote `mcp.dev`/remote-worker server).
3. The three core JSON-RPC methods a client needs: `initialize`, `tools/list`, `tools/call` — returning typed results, not raw strings.
4. A fixture-driven `McpTestServer` that a unit test drives over a real stdio pipe, plus an SSE transport test against a local handler.

The day establishes the **one client** that Days 02–04 will point at GitHub/GitLab/Bitbucket/Jira servers. We write the client, not the integrations — the internet already ships the servers.

---

## 2. Design Decisions

### 2.1 The client is the product; the servers are adopted, not built

MCP is an open protocol with an existing ecosystem: GitHub, GitLab, Bitbucket, and Atlassian all publish MCP servers. `@harness/mcp` only speaks the protocol — `initialize` handshake, tool discovery, tool invocation. Adding a new host tomorrow is a config entry (Day 02), never a new adapter class.

### 2.2 Transport seam first

```typescript
// packages/mcp/src/transport.ts
export interface McpTransport {
  start(): Promise<void>;                       // connect / spawn / open stream
  send(message: unknown): Promise<void>;        // JSON-RPC request
  onMessage(handler: (m: unknown) => void): void;
  onClose(handler: (err?: Error) => void): void;
  stop(): Promise<void>;
}
```

- `StdioTransport` — `child_process.spawn(command, args)`, framed as JSON-lines over stdin/stdout, stderr captured (never let a server crash look like a silent hang).
- `SseTransport` — connect to an SSE endpoint, POST tool calls to its message URL, stream responses.

### 2.3 Protocol surface — nothing host-specific

```typescript
export interface McpClient {
  initialize(): Promise<ServerInfo>;            // { name, version, capabilities }
  listTools(): Promise<McpTool[]>;              // { name, description, inputSchema }
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}
```

`ToolResult` is `{ isError, content: ToolContent[] }`, where `ToolContent` is `{ type: 'text' | 'image' | 'resource', ... }` — the MCP content model, mapped 1:1, never flattened into a host's idea of a PR.

### 2.4 Timeouts and lifecycle

Every `callTool` runs under a wall-clock timeout (default 30s, configurable); `close()` tears down the transport and kills the subprocess. A server that emits a non-JSON line logs a warning and is dropped — the caller gets a typed `McpClientError`, not a truncated blob.

---

## 3. Tasks

### 3.1 Scaffold `@harness/mcp` (30 min)

- [ ] `packages/mcp/package.json` (`@harness/mcp`), `tsconfig.json`, `src/index.ts`, boundary config entry (`@harness/mcp` → `@harness/domain` only).
- [ ] README stub + module table.

### 3.2 Protocol types (45 min)

- [ ] `src/protocol.ts` — JSON-RPC envelope, `initialize`/`tools/list`/`tools/call` request + response types, `ToolResult`/`ToolContent`, `McpTool`.
- [ ] Zod schemas for inbound message validation (a malformed server is an error, not a crash).

### 3.3 `StdioTransport` (90 min)

- [ ] Spawn subprocess; JSON-lines framing; stderr capture; graceful kill on `stop()`.
- [ ] Handle process exit mid-call → `McpClientError('server exited')`.

### 3.4 `SseTransport` (75 min)

- [ ] Open SSE stream, read `endpoint` event, POST follow-up messages; reconnect-once on drop.
- [ ] Abort on timeout.

### 3.5 `McpClient` head (60 min)

- [ ] `initialize()` → `ServerInfo`; `listTools()`; `callTool()` with id correlation + pending-request map.
- [ ] Request/response id matching so concurrent calls don't cross.

### 3.6 Tests (90 min)

- [ ] `McpTestServer` fixture — a minimal server answering initialize/list/call over stdio.
- [ ] SSE transport test against a local HTTP handler.
- [ ] Timeout → `McpClientError`; malformed line → error (no crash); double-close → idempotent.
- [ ] `grep -r "from '@harness" packages/mcp/src` → only `@harness/domain`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/mcp/package.json` + `src/index.ts` | New `@harness/mcp` package |
| `packages/mcp/src/transport.ts` | `McpTransport` + `StdioTransport` + `SseTransport` |
| `packages/mcp/src/protocol.ts` | JSON-RPC + MCP content types (Zod-validated) |
| `packages/mcp/src/mcp-client.ts` | `McpClient` (initialize/list/call/close) |
| `packages/mcp/src/__tests__/*.test.ts` | Fixture server + transport tests |
| `packages/mcp/README.md` | Modules + "MCP client complete" status |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/mcp test` — protocol + both transports pass against fixtures (no real external server, no live token).
- [ ] `callTool` returns typed `ToolResult { isError, content[] }`, not a raw string.
- [ ] Concurrent `callTool`s correlate by request id (no crossed responses).
- [ ] Server exit / timeout / malformed line → `McpClientError` (never a hang or silent truncation).
- [ ] `grep -r "from '@harness" packages/mcp/src` shows only `@harness/domain`.
- [ ] `pnpm lint` clean; **no MCP server binary or token committed** — the fixture server is in-repo, test-only.

---

## 6. Notes & Pitfalls

- **This package must not know what "PR" or "MR" means.** If a GitHub/GitLab symbol shows up here, the abstraction leaked. Host mapping belongs in Days 03–04 (`@harness/git-provider` / `@harness/ticket-provider`).
- **JSON-RPC id correlation is the classic bug.** Without matching request ids, two concurrent `tools/call` responses can be assigned to the wrong waiter — the pending-map test exists to catch it.
- **Don't cache tokens in the client.** The client is transport-only; credentials arrive as env vars for the *server subprocess* (Day 02) or headers for SSE — never in-process cache, never logged.
- **SSE is stateful.** Connecting twice or leaving a stream open leaks; `close()` must be idempotent and safe to call after a dropped connection.
- **Tomorrow (Day 02):** `mcp.config.json` — the one file that lists which servers to connect.

---

*Next: [Day 02 — `mcp.config.json`: One File Connecting GitHub/GitLab/Bitbucket/Jira](day-02.md)*