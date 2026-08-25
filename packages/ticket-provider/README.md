# @harness/ticket-provider — Ticket System Read Seam

The provider seam that reads a requirement from a ticket system (Jira), so the AI
reviewer has a spec/requirement to weigh the MR/PR against — and, for the
write-back path, maps comment/transition to the same system's MCP tools.

**Status:** complete (as-built) ·
**Boundary rule:** depends only on `@harness/domain`; never an engine, host SDK, or event-bus.

---

## Purpose

1. **Define the `TicketProvider` seam** — fetch issue metadata + description.
2. **Provide a Jira REST implementation** — `JiraProvider` over Cloud REST `fetch`,
   no SDK (the direct REST path).
3. **Front Jira through MCP** — `MCPTicketProvider` drives the `jira` MCP server via
   `TicketToolMap`, so Jira read/write is served from `mcp.config.json`, not a
   REST adapter.
4. **Map host JSON → domain `Issue`** — flattening Jira's ADF description to plain
   text via the pure, fixture-testable `adfToPlainText` (REST and MCP variants).

```text
   POST /api/reviews { jiraTicket: "ACME-1234" }
            │
            ▼
   resolveReviewInput → MCPTicketProvider.fetchIssue({ key })
            │
            ▼
   Issue { summary, description }  →  AI reviewer's "requirements" input
```

## Interface

```typescript
interface TicketProvider {
  readonly type: TicketProviderType;
  fetchIssue(input: FetchIssueInput): Promise<Issue>;
}
```

- `FetchIssueInput.key` is the host issue key (e.g. `ACME-1234`).
- Errors are always `TicketProviderError` (with optional `status`) or
  `UnknownTicketSystemError` (an unconfigured system), never thrown raw.

## Modules

| Module | What it provides |
| --- | --- |
| `ticket-provider.ts` | `TicketProvider`, `FetchIssueInput`, `TicketProviderError`. |
| `jira-provider.ts` | `JiraProvider` — bearer-token REST against a configurable `baseUrl`. |
| `jira-mapper.ts` | `mapJiraIssue`, `adfToPlainText`, and the raw Jira payload subset. |
| `ticket-tool-map.ts` | `TicketToolMap` / `StaticTicketToolMap` — per-system capability→tool-name + arg-encoding table (read + write). |
| `mcp-ticket-mapper.ts` | `mapMcpTicketIssue` — `ToolContent[]` → `Issue`. |
| `mcp-ticket-provider.ts` | `MCPTicketProvider` — fetch via MCP tools; `UnknownTicketSystemError`. |

## Test strategy

- The mapper + `adfToPlainText` are tested against fixture ADF documents (nested
  paragraphs / text nodes), no live token; the MCP mapper is tested against fixture
  `ToolContent[]`.
- The provider's `fetch`/MCP client is stubbed; no live credential is required or
  committed.

## Directory structure

```
src/
├── index.ts
├── ticket-provider.ts
├── jira-provider.ts / jira-mapper.ts
├── ticket-tool-map.ts
└── mcp-ticket-mapper.ts / mcp-ticket-provider.ts
```

## Public API surface

```typescript
// TicketProvider, FetchIssueInput, TicketProviderError,
// JiraProvider, mapJiraIssue, adfToPlainText, JiraIssuePayload,
// TicketToolMap, StaticTicketToolMap, mapMcpTicketIssue, MCPTicketProvider, UnknownTicketSystemError
```

## Dependency rule

```
packages/ticket-provider → imports only @harness/domain
```

Write-back (issue transition / comment) is *not* a second adapter here — it is the
`@harness/writeback` seam driving the same `TicketToolMap` through `@harness/mcp`.