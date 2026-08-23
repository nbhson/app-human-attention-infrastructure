# Day 04 — `MCPTicketProvider`: Jira MCP Tools → `Issue` + Comment/Transition

| | |
|---|---|
| **Week** | 1 — MCP connectivity |
| **Spec refs** | ticket-provider §2 (`TicketProvider` seam), §4 (modules); Architecture §7 (boundary rule) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 03 (`MCPGitProvider` + `GitToolMap`); Phase-1 `TicketProvider` seam + `Issue` shape |

---

## 1. Objectives

By end of day you will have:

1. An `MCPTicketProvider` implementing `TicketProvider` through the **Jira MCP server** — `fetchIssue`, `postComment`, and `transition` all issued as MCP `tools/call`s, not Jira REST.
2. A `TicketToolMap` binding ticket capabilities → Jira MCP tool names (fetch issue, search, add comment, transition).
3. A pure mapper flattening MCP `ToolContent` → the `Issue` domain shape (key, summary, description, status, labels).
4. Fixture-tested mapping + a stubbed-`McpClient` provider test covering comment/transition — no live Jira, no live token.

Together with Day 03, this completes "Git + ticket via MCP" — the Week-1 breadth slice, with **no per-provider REST code**.

---

## 2. Design Decisions

### 2.1 Same seam, same transport story

`MCPTicketProvider` mirrors `MCPGitProvider`: it fronts the Jira MCP server through the registry and maps capabilities to tool names. `TicketProvider`'s write primitives are **commentary/status** (the invariant holds — a comment or a status transition, never code):

```typescript
// packages/ticket-provider/src/mcp-ticket-provider.ts
export class MCPTicketProvider implements TicketProvider {
  constructor(private registry: McpServerRegistry, private toolMap: TicketToolMap) {}
  fetchIssue(input: FetchIssueInput): Promise<Issue>;
  postComment(input: FetchIssueInput, body: string): Promise<void>;
  transition(input: FetchIssueInput, toState: string): Promise<void>;
}
```

### 2.2 A tool map, not a REST client

```typescript
interface TicketToolMap {
  fetch: string; search: string; comment: string; transition: string;  // Jira MCP tool names
}
```

The Atlassian Jira MCP server exposes these as tools; `MCPTicketProvider` binds them once. A different ticket MCP server later = one more tool-map row.

### 2.3 Transitions by human-readable name

The Jira MCP `transition` tool takes a target status **name**. `transition(input, toState)` passes `toState` through and maps a "no such status" tool error to a `TicketProviderError` that lists the available statuses if the server returned them — same human-facing contract the REST design promised.

### 2.4 Comments are plain text, not ADF, at this layer

The MCP server accepts (and the LLM produces) plain text; ADF construction is a server-side concern when it is one at all. `MCPTicketProvider` sends `body` verbatim and only normalizes errors — the flatten-to-ADF round-trip the REST adapter needed is gone with the client.

---

## 3. Tasks

### 3.1 `TicketToolMap` (30 min)

- [ ] `packages/ticket-provider/src/ticket-tool-map.ts` — Jira capability→tool-name bindings + a `search` passthrough.

### 3.2 `MCPTicketProvider` (90 min)

- [ ] `fetchIssue` / `postComment` / `transition` → registry client → `tools/call(...)`.
- [ ] `TicketProviderError` on `ToolResult.isError`; "no such status" → error listing available transitions.

### 3.3 `mcp-ticket-mapper.ts` (60 min)

- [ ] Flatten `ToolContent[]` → `Issue`; strip Jira's rich-text wrapper to plain `description`.

### 3.4 Stubbed-provider tests (75 min)

- [ ] Fake `McpClient` returning fixture issue/comment/transition results; assert correct tool names + args.
- [ ] Error-path: isError → `TicketProviderError`; transition no-match error surfaces available names.

### 3.5 Exports + boundary (30 min)

- [ ] `src/index.ts` + README module table gain `MCPTicketProvider` + mapper.
- [ ] `grep -r "from '@harness" packages/ticket-provider/src` → `@harness/domain` + `@harness/mcp` only.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/ticket-provider/src/mcp-ticket-provider.ts` | `MCPTicketProvider` (fetch/comment/transition via MCP) |
| `packages/ticket-provider/src/ticket-tool-map.ts` | Jira capability→tool-name bindings |
| `packages/ticket-provider/src/mcp-ticket-mapper.ts` | `ToolContent[]` → `Issue` |
| `packages/ticket-provider/src/__tests__/mcp-ticket-*.test.ts` | Stubbed `McpClient` tests |
| `packages/ticket-provider/README.md` (updated) | Modules + "MCP-backed TicketProvider" status |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/ticket-provider test` — green with a stubbed `McpClient` (no live Jira/token).
- [ ] `fetchIssue` returns an `Issue` structurally identical to Phase-1 `JiraProvider` output.
- [ ] `postComment` and `transition` call the mapped Jira MCP tools with the right args.
- [ ] No-such-status → `TicketProviderError` listing available statuses (when the server provides them).
- [ ] JSDoc/comments state the commentary/status boundary (never code).
- [ ] `grep -r "from '@harness" packages/ticket-provider/src` shows only `@harness/domain` + `@harness/mcp`.

---

## 6. Notes & Pitfalls

- **Jira's "description" is rarely plain.** Whatever format the MCP server returns, the mapper owns normalizing it to text — keep that normalization here, not in the reviewer prompt.
- **Transition names are tenant-specific** ("In Review" may not exist). Always go through the tool at call time; never hard-code an id. The MCP tool name is stable even where the workflow isn't.
- **Comment/transition are the write-back primitives** Day 06 will wrap under `WriteBackService` — expose the capability today, add idempotency + audit in Day 08.
- **Do not let Jira REST sneak back.** If a `POST /rest/api/3/...` string appears, the abstraction leaked; it's a `tools/call` with a mapped tool name.
- **Tomorrow (Day 05):** Week 1 checkpoint — fetch PR/MR from GitHub/GitLab/Bitbucket + a Jira issue, all via one config.

---

*Next: [Day 05 — Week 1 Checkpoint: Fetch PR/MR from GitHub/GitLab/Bitbucket + Jira via MCP](day-05.md)*