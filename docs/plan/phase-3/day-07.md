# Day 07 — Write-back for GitLab/Bitbucket + Jira Transition via MCP Tools

| | |
|---|---|
| **Week** | 2 — Write-back |
| **Spec refs** | Phase-3 README §3; git-provider §2, ticket-provider §2 (MCP write tools) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 06 (`WriteBackService` + `MCPWriteBack`); `MCPTicketProvider` transition (Day 04) |

---

## 1. Objectives

By end of day you will have:

1. `MCPWriteBack` covering the **full provider matrix** — GitHub/GitLab/Bitbucket comment/status, Jira comment/transition — through each host's MCP write tools.
2. Per-host *write* tool-name bindings filled out in `GitToolMap`/`TicketToolMap` (the read bindings from Days 03–04 get their write counterparts).
3. `WriteBackService` dispatching to any provider behind one interface; a decision on any host produces the same-shaped external write.
4. Fixture-tested adapters against fake `McpClient`s — no live credentials.

Completes write-back breadth; Day 08 layers audit + idempotency on top. Note there are **no per-host write classes** — breadth is tool-name rows, not packages.

---

## 2. Design Decisions

### 2.1 One adapter, N tool rows

`MCPWriteBack` stays a single class; the *only* per-host variance is which tool name each action maps to. Extending `GitToolMap`/`TicketToolMap` with write columns completes the matrix — no `GitLabWriteBack`/`BitbucketWriteBack`/`JiraWriteBack` classes are needed.

### 2.2 Jira's write is a transition, codified

The intent vocabulary already carries `TRANSITION` (from Day 06). Git hosts reject it with `WriteBackError`; Jira maps it to its transition tool with the human-readable `toState`. Jira's STATUS/LABEL semantics don't map anywhere and are rejected for Jira — the tool map makes that explicit per host rather than implicit in code.

### 2.3 Adapter errors normalize to `WriteBackError`

Every host tool error folds into `WriteBackError { provider, action, externalId, status? }` so the service logs one shape regardless of host — and so the idempotency layer (Day 08) keys on one type.

### 2.4 Idempotency is not today

Today proves breadth; Day 08 adds the dedup key + `writeback_log`. Keep the adapter stateless (no "already sent" memory) so the audit layer can own that concern.

---

## 3. Tasks

### 3.1 Write tool-map rows (75 min)

- [ ] `GitToolMap`: fill comment/status (and label where the host exposes one) for github/gitlab/bitbucket.
- [ ] `TicketToolMap`: fill comment + transition for Jira; mark STATUS/LABEL unsupported.

### 3.2 `MCPWriteBack` matrix (120 min)

- [ ] Map each (provider × action) to its tool name + args; TRANSITION passes `toState`.
- [ ] Per-host rejection matrix (git→TRANSITION, jira→STATUS/LABEL) → `WriteBackError`.

### 3.3 Service dispatch update (45 min)

- [ ] Wire the completed matrix into `write()`; normalize host errors → `WriteBackError`.

### 3.4 Boundary + full pass (30 min)

- [ ] `@harness/writeback` imports only `domain` + `mcp` (+ type-only tool maps).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/git-provider/src/git-tool-map.ts` (updated) | Write capability→tool rows |
| `packages/ticket-provider/src/ticket-tool-map.ts` (updated) | Jira comment/transition rows |
| `packages/writeback/src/mcp-writeback.ts` (updated) | Full provider matrix via MCP tools |
| `packages/writeback/src/writeback-service.ts` (updated) | Error normalization |
| `packages/writeback/src/__tests__/*.test.ts` | Matrix + rejection tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/writeback test` — green; all four providers dispatched via MCP tools.
- [ ] COMMENT writes a comment on all three Git hosts + Jira (fake client spy).
- [ ] TRANSITION transitions Jira by status name; STATUS sets a commit status on GitHub/GitLab/Bitbucket.
- [ ] Git hosts reject TRANSITION, Jira rejects STATUS/LABEL — with `WriteBackError`.
- [ ] No per-host write classes exist (grep for `GitLabWriteBack`/`BitbucketWriteBack`/`JiraWriteBack` returns nothing).
- [ ] Boundary grep clean; `pnpm lint` clean.

---

## 6. Notes & Pitfalls

- **Breadth is data, not code.** If a checkout shows three new write classes, the MCP abstraction failed — walk it back to tool-map rows.
- **Bitbucket status needs a stable app `key`.** Keep one constant per provider tool binding; don't generate per call or idempotency (Day 08) loses its stable identity.
- **GitLab status targets a SHA.** The head SHA comes from the already-fetched `PullRequest` — pass it in the intent, don't re-fetch via a new tool call.
- **Jira transition is stateful and human-visible.** `toState` is a name the human chose; the no-such-status error (Day 04) is surfaced, not swallowed.
- **Day 08** layers `writeback_log` + idempotency so a retry can't double-comment.

---

*Next: [Day 08 — `writeback_log` Audit + Idempotency (No Duplicate Comments)](day-08.md)*