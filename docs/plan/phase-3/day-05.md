# Day 05 — Week 1 Checkpoint: Fetch PR/MR from GitHub/GitLab/Bitbucket + Jira via MCP

| | |
|---|---|
| **Week** | 1 — MCP connectivity |
| **Spec refs** | Phase-3 README §5 (W1 milestone); git-provider §2, ticket-provider §2 |
| **Estimated effort** | 5h |
| **Prerequisites** | Days 01–04 (`@harness/mcp`, `mcp.config.json`, `MCPGitProvider`, `MCPTicketProvider`) |

---

## 1. Objectives

By end of day you will have:

1. A demonstrable end-to-end ingest: paste a **GitHub PR**, **GitLab MR**, or **Bitbucket PR** URL + a **Jira key** → the diff + requirement fetch **through one `mcp.config.json`**, each host fronted by its MCP server via `@harness/mcp`.
2. A scripted demo (`scripts/demo-mcp-connectivity.ts`) exercising all four servers against the in-repo **stubbed MCP servers** (no live credentials in CI).
3. Integration debt from Days 01–04 closed: registry lifecycle, tool-map coverage, and seam-shape parity verified together, not in isolation.
4. Week-1 milestone green: "`@harness/mcp` client + `mcp.config.json`; fetch PR/MR from GitHub/GitLab/Bitbucket + a Jira issue, all through one config file (no per-host REST)."

The checkpoint is a *slice-wide* proof, not new features — make "one config connects any tool" demonstrable.

---

## 2. Design Decisions

### 2.1 Demo runs stubbed, live-optional

CI can't hold real tokens for four MCP servers. The demo runs against **in-repo stubbed MCP servers** (fixtures returning the exact `ToolContent` Days 03–04 produced); a `--live` flag switches to the real `mcp.config.json` when a developer exports the `*_TOKEN` env vars. "Demonstrable" holds every day, not just on one laptop.

### 2.2 One ingest facade over both providers

Expose `resolveReviewInput({ prUrl, jiraKey })` in `apps/api` that picks `MCPGitProvider`/`MCPTicketProvider` by host and returns unified `{ pullRequest, issue }` — a single call site for the reviews route. No engine imports the provider packages directly.

### 2.3 The seam-parity contract

`MCPGitProvider` (all three hosts) and `MCPTicketProvider` must produce a `PullRequest` / `Issue` **structurally identical** to the Phase-1 REST outputs. The sanity test diffs the mapped fixtures against the shared shapes — unit tests checked individually; today checks them *together*.

---

## 3. Tasks

### 3.1 Stubbed MCP server fixtures (90 min)

- [ ] Reuse/extend the Day-01 `McpTestServer` to stand in for github/gitlab/bitbucket/jira servers, serving the fixture `ToolContent` for PR/MR/issue tools.
- [ ] A test `mcp.config.json` pointing all four names at the stubs (stdio subprocess, secret-free).

### 3.2 Demo script (60 min)

- [ ] `scripts/demo-mcp-connectivity.ts` — for each host URL, resolve → fetch → print `title`, `fileCount`, first change kind; then `fetchIssue(jiraKey)`.
- [ ] Stub by default; `--live` flag.

### 3.3 Ingest facade (45 min)

- [ ] `resolveReviewInput` in `apps/api` — resolves git + ticket providers, returns `{ pullRequest, issue }`.

### 3.4 Seam-parity sanity test (45 min)

- [ ] One shared `assertPullRequestShape`/`assertIssueShape` validator passed by all three hosts + Jira.

### 3.5 Run the checkpoint (45 min)

- [ ] `pnpm demo:mcp-connectivity` (stubbed) completes across GitHub/GitLab/Bitbucket + Jira.
- [ ] Record the demo output in `docs/retros/` as W1 evidence.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo-mcp-connectivity.ts` | Demo: all three hosts + Jira via MCP |
| `packages/mcp/src/__tests__/stub-servers/*` | In-repo stubbed MCP servers |
| `apps/api/src/review-input-facade.ts` | `resolveReviewInput` facade |
| `apps/api/src/__tests__/seam-parity.test.ts` | Shared `PullRequest`/`Issue` shape check |
| `docs/retros/phase3-w1.md` | Week 1 checkpoint evidence |

---

## 5. Acceptance Criteria

- [ ] `pnpm demo:mcp-connectivity` runs stubbed end-to-end and prints a fetched PR/MR for each of GitHub, GitLab, Bitbucket + a Jira issue — all via `@harness/mcp`.
- [ ] `resolveReviewInput` resolves by host without per-host REST classes.
- [ ] The seam-parity validator passes for all three hosts + Jira against the Phase-1 shapes.
- [ ] No live token required; no key committed; `mcp.config.json` real file git-ignored.
- [ ] `pnpm test && pnpm lint` green across `mcp`, `git-provider`, `ticket-provider`, `db`, `api`.

---

## 6. Notes & Pitfalls

- **Checkpoint ≠ new feature.** No write-back or verification today — a clean demo + closing integration debt. Days 06–10 own write-back (over the same MCP tools).
- **Stubs must survive the real mapper.** If a stub returns a shape the mapper would reject, the demo proves nothing — reuse Days 03–04 fixtures verbatim.
- **The win to state out loud:** "we added GitLab, Bitbucket, and Jira in one week by writing *one client + one config file*, not three REST SDKs." That's the MCP thesis this checkpoint exists to demonstrate.
- **Next week (Day 06):** `WriteBackService` — commentary/status write-back behind a per-provider toggle, executed via the MCP tools already online.

---

*Next: [Day 06 — `WriteBackService` Interface + MCP-Backed Comment/Status Impl](day-06.md)*