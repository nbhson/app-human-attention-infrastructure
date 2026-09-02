# Phase 3 · Week 1 Retro — MCP connectivity checkpoint

_Day-05 checkpoint (Phase 3, Week 1). Week 1 built the connectivity layer that
carries the whole re-orientation: one `@harness/mcp` client + one
`mcp.config.json` in place of four per-host REST adapters, then proved it by
fetching a PR/MR from GitHub, GitLab, and Bitbucket plus a Jira issue — all
through the one config file. Same rule as every prior retro: honest by design,
numbers-first, blameless, and green before committed._

---

## What held

- **"One config connects any tool" is proven, not asserted.** The week's whole
  thesis — add a host by writing a config entry + a tool-map row, never a REST
  SDK — lands as a runnable demo (`pnpm demo:mcp-connectivity`), not a claim.
  The stub is a _single_ stdio subprocess answered by tool name
  (`get_pull_request` → GitHub, `get_merge_request` → GitLab, `get_pullrequest` →
  Bitbucket, `get_issue` → Jira), so the host discriminator is the protocol tool,
  not the process. GitHub, GitLab, and Bitbucket were "added" in one week by
  writing one client + one config file.
- **The seam stayed, the transport changed.** `MCPGitProvider` and
  `MCPTicketProvider` return the _same_ `PullRequest`/`Issue` value objects the
  Phase-1 REST adapters produced — the mappers consume one canonical JSON shape
  per capability, transported as JSON-in-text. The `resolveReviewInput` facade is
  the single call site the reviews route will use; nothing in `apps/api` imports
  a `GitHubProvider`/`JiraProvider` class.
- **The stub survives the real mapper.** Day-05 §6's trap — "if a stub returns a
  shape the mapper would reject, the demo proves nothing" — was the one real
  sharp edge, and it was respected: the fixtures reuse Days 03–04's canonical
  shapes verbatim, and the seam-parity test re-asserts them all four ways.

## The W1 evidence (recorded demo output)

`pnpm demo:mcp-connectivity` (stubbed, no live credentials):

```
demo:mcp-connectivity — mode=stubbed (forge-server.mjs)
one @harness/mcp client + one mcp.config.json fronts GitHub, GitLab, Bitbucket, and Jira
— no per-host REST SDK.

=== github.com ===
  repo:    github.com/acme/widget#1  (provider=github)
  title:   "Fix: dedupe the actor backfill query"
  files:   2
  first:   src/actors/backfill.ts (MODIFIED, +12 -4)

=== gitlab.com ===
  repo:    gitlab.com/acme/widget#7  (provider=gitlab)
  title:   "Chore: bump the sandbox image tag"
  files:   2
  first:   docker-compose.yml (MODIFIED, +1 -1)

=== bitbucket.org ===
  repo:    bitbucket.org/acme/widget#3  (provider=bitbucket)
  title:   "Refactor: extract the review queue writer"
  files:   2
  first:   src/review/writer.ts (DELETED, +0 -41)

=== Jira ===
  key:     ACME-42  (provider=jira)
  summary: "Fix the thing"
  type:    Bug
  url:     https://acme.atlassian.net/browse/ACME-42
```

## What drifted (and how it was caught)

- **Day-04's write primitives shipped once as "not wired", then were rewired.**
  The first cut of `MCPTicketProvider.postComment`/`transition` mirrored Day-03's
  git posture and threw "not wired until Day 06". Re-reading day-04 §1.1/§5
  showed the plan wants the ticket write path _wired as MCP tools_ (fetch +
  comment + transition all through MCP), with only the toggle/audit wrapper
  deferred to Day 06. Amended before the Day-04 commit — the provider exposes the
  raw write capability for free; `WriteBackService` wraps it next week.
- **The demo lives in the api `scripts/` dir, not the root `scripts/demo/`.**
  The root `scripts/demo/` holds markdown _runbooks_ (week1…week6); the Day-05
  deliverable named `scripts/demo-mcp-connectivity.ts` was placed next to the
  other `tsx` drivers in `apps/api/scripts/` for the same `tsx` + `tsconfig.scripts`
  wiring the seeders already use.

## What Week 2 must watch

- **`WriteBackService` (Day 06) is the first _write_ over the same MCP tools.**
  The read path is now proven across every host; the write path exists only as
  raw provider primitives. The toggle + idempotency + audit wrapper is what makes
  it safe to _never_ write externally by default — watch that the off-by-default
  posture is asserted in a test, not just documented.
- **`--live` is an explicit refusal, not a silent fallback.** The demo refuses to
  run live when `mcp.config.json` is absent/empty; it will _never_ fetch through
  a half-configured environment. `mcp.config.json` stays git-ignored, and
  `.env.example` carries only placeholder token values.

## Boundary check

- **Neither provider leaked past its seam.** `git-provider` and `ticket-provider`
  depend on exactly `['@harness/domain', '@harness/mcp']` (the architecture test
  R13/R14 now assert this), and the new `apps/api` facade pulls both through their
  public indexes — no engine imported a provider, and no provider imported a
  sibling package. The MCP client remains a protocol leaf.

---

_Checkpoint rule applied: `pnpm typecheck` (42/42), `pnpm lint`, and `pnpm test`
(**704** tests / 128 files) are all green before this note is committed. The
stubbed demo runs end-to-end with no live token and no key in the repo._

_Next: Day 06 — `WriteBackService` interface + MCP-backed comment/status impl._
