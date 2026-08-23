# Day 06 — `WriteBackService` Interface + MCP-Backed Comment/Status Impl

| | |
|---|---|
| **Week** | 2 — Write-back |
| **Spec refs** | Phase-3 README §3 (write-back anchor), §4; git-provider §2 (comment/status via MCP tools) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 05 (W1 checkpoint); `MCPGitProvider` + `MCPTicketProvider` online with comment/status/transition tools |

---

## 1. Objectives

By end of day you will have:

1. A `WriteBackService` seam — the single entry point for **commentary/status write-back** (PR comment/label/status, Jira comment/transition), explicitly *never code, never a commit*.
2. A first adapter behind it that maps write-back intents onto the **MCP tools already connected in Week 1** (the git server's comment + status tools, the Jira server's comment/transition tools) — no new REST client.
3. A domain contract `WriteBackIntent` (`COMMENT` | `STATUS` | `LABEL` | `TRANSITION`) carrying an `externalId`, `provider`, `body`, and no code payload.
4. A decision-time call site (stub behind toggle) proving the seam is reachable from the review-decision path.

The day establishes the **write-back seam over MCP**; Day 07 covers the full provider matrix, Day 08 adds audit + idempotency.

---

## 2. Design Decisions

### 2.1 Write-back rides the same MCP transport

The MCP servers Week 1 connected already expose *write* tools (add comment, set commit status, add label, transition issue). `WriteBackService` does not open a second channel — it calls the tools through `@harness/mcp`, so there is exactly **one** way the harness talks to Git/ticket systems. Writing is a tool call with a side effect, not a code change.

### 2.2 The intent type cannot express a code change

```typescript
// packages/domain/src/writeback.ts
export type WriteBackAction = 'COMMENT' | 'STATUS' | 'LABEL' | 'TRANSITION';

export interface WriteBackIntent {
  id:         string;
  provider:   GitOrTicketHost;     // 'github' | 'gitlab' | 'bitbucket' | 'jira'
  externalId: string;              // PR/MR number or ticket key
  action:     WriteBackAction;
  body?:      string;              // comment text / status description
  state?:     'pending' | 'success' | 'failure';
  label?:     string;
  toState?:   string;              // transition target (Jira)
}
```

### 2.3 Service is a seam; adapters bind tool names

```typescript
export interface WriteBackService {
  write(intent: WriteBackIntent): Promise<WriteBackResult>;   // { ok, externalRef }
}
```

`MCPWriteBack` resolves the provider's client from `McpServerRegistry`, maps the action to a tool name (via the same `GitToolMap`/`TicketToolMap`), and calls it. A new host drops in with no decision-path changes.

### 2.4 Toggle OFF = no tool called

The service carries an `enabled(provider)` guard from config. Today hard-wired to a `WRITEBACK_*` env check per provider — Day 09 promotes it to the per-review decision toggle.

---

## 3. Tasks

### 3.1 Domain contract (30 min)

- [ ] `packages/domain/src/writeback.ts` — `WriteBackAction`, `WriteBackIntent`, `WriteBackResult`.

### 3.2 Scaffold `@harness/writeback` (30 min)

- [ ] `packages/writeback/package.json` (`@harness/writeback`); deps `@harness/domain`, `@harness/mcp`, and (for type-only) `@harness/git-provider` + `@harness/ticket-provider` tool maps.

### 3.3 `WriteBackService` + MCP adapter (120 min)

- [ ] `src/writeback-service.ts` — `write()` dispatch by provider + `enabled` guard.
- [ ] `src/mcp-writeback.ts` — COMMENT → comment tool, STATUS → status tool, LABEL → label tool, TRANSITION → transition tool (rejected for git hosts).

### 3.4 Tool-map write bindings (60 min)

- [ ] Extend `GitToolMap`/`TicketToolMap` with write capability→tool-name rows (comment/status/label for hosts that expose them; transition for Jira).

### 3.5 Decision-path stub (60 min)

- [ ] In the review-decision handler, accept a `writeback` flag; when on, build a `COMMENT` intent and call `WriteBackService.write` — stubbed behind the env toggle.

### 3.6 Tests (60 min)

- [ ] Intent type: no code field (compile-time). COMMENT/STATUS/LABEL/TRANSITION map to the right MCP tools (fake `McpClient`).
- [ ] `enabled=false` → no tool called (spy); git host rejects TRANSITION with `WriteBackError`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/domain/src/writeback.ts` | `WriteBackIntent`/`Service` contract |
| `packages/writeback/package.json` + `src/index.ts` | New `@harness/writeback` package |
| `packages/writeback/src/writeback-service.ts` | Provider-dispatch service + enabled guard |
| `packages/writeback/src/mcp-writeback.ts` | MCP-tool-backed adapter |
| `apps/api/src/routes/reviews.ts` (updated) | Decision-time write-back stub behind toggle |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/writeback test` — green.
- [ ] `WriteBackIntent` has no code/commit/diff field (type-level).
- [ ] COMMENT/STATUS/LABEL/TRANSITION intents hit the right MCP tools (fake client spy).
- [ ] `enabled=false` for a provider → zero external tool calls.
- [ ] Git hosts reject TRANSITION with `WriteBackError`.
- [ ] `pnpm lint` clean; no new REST entry point.

---

## 6. Notes & Pitfalls

- **The intent type is the guardrail.** A future "write code" feature can't add a slot without a visible, reviewable type change — that's deliberate.
- **One transport, read and write.** Write-back must not reintroduce `fetch` calls to host REST — it calls MCP tools. A stray `https://api.github.com` string is a regression.
- **Tool-name mapping lives with the tool maps, not the service.** Keeping write bindings beside read bindings stops the capability→name table from fragmenting across packages.
- **Day 07** completes the matrix (GitLab/Bitbucket + Jira transition) over the same MCP tools.

---

*Next: [Day 07 — Write-back for GitLab/Bitbucket + Jira Transition via MCP Tools](day-07.md)*