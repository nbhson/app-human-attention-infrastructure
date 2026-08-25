# Phase 3 · Week 2 Retro — Write-back checkpoint

*Day-10 checkpoint (Phase 3, Week 2). Week 2 took the transport Week 1 connected
and made it safe to **write** through: one `WriteBackService` seam over the same
MCP client, a full provider matrix (GitHub/GitLab/Bitbucket comment+status, Jira
comment+transition), an append-only audit with claim-then-write idempotency, and a
three-layer toggle that is off unless a human arms it. The week ends with one
provable statement — **approve with write-back ON → the comment/status lands;
OFF → nothing external, and the empty `writeback_log` is the proof.** Same rule as
every prior retro: honest by design, numbers-first, blameless, and green before
committed.*

---

## What held

- **"OFF is provable" is the deliverable that mattered, and it lands as a
  query, not a claim.** The three-layer gate fails safe — request `writeback`
  flag ∧ global `WRITEBACK_ENABLED` ceiling ∧ per-provider `WRITEBACK_<PROVIDER>` —
  and a disarmed write resolves to a successful no-op that records *zero* rows.
  A reviewer who decides "no automatic comment this time" proves it by the empty
  `writeback_log`, not by a log line saying it skipped.
- **One transport, read and write.** `MCPWriteBack` rides the same `@harness/mcp`
  client Week 1 proved for reads; no second REST channel exists anywhere. The
  host-vs-ticket variance lives entirely in the tool maps — there is no per-host
  write class, and the whole matrix (`add_pr_comment`, `set_pr_status`,
  `create_mr_note`, `set_mr_status`, `add_comment`, `transition_issue`) is reached
  by a single `write(intent)` entry point.
- **Idempotency is the safety property.** A retried decision folds to one
  `sha256(provider|externalId|action|body)` fingerprint; the unique partial index
  on `dedup_key WHERE status='SUCCEEDED'` guarantees a racing or retried
  identical write degrades to `DUPLICATE` — one external comment, never two.
- **Redaction is exercised on a real error shape, not a happy fixture.** A
  forced 401 (`Authorization: Bearer ghp_…`) is caught, scrubbed, and stored as
  `Authorization: [redacted]` in both the return value and the `FAILED` audit row.

## The W2 evidence (recorded demo output)

`pnpm demo:writeback` (stubbed transport, no live credentials):

```
=== 1. the three-layer toggle (fail-safe: any layer OFF = silent) ===
  global ceiling:  writebackEnabled(true, {})                     → false
  global ceiling:  writebackEnabled(true, { WRITEBACK_ENABLED:'1' }) → true
  request flag:    writebackEnabled(undefined, { WRITEBACK_ENABLED:'1' }) → false
  per-provider:    WRITEBACK_GITHUB unset → write() calls 0 tools, 0 audit rows ✓

=== 2. APPROVE (ON) → one decision writes COMMENT + STATUS across git hosts ===
  github.com    COMMENT+STATUS → add_pr_comment, set_pr_status · fake-1, fake-2 ✓
  gitlab.com    COMMENT+STATUS → create_mr_note, set_mr_status · fake-1, fake-2 ✓
  bitbucket.org COMMENT+STATUS → add_pr_comment, set_pr_status · fake-1, fake-2 ✓
  jira          COMMENT+TRANSITION → add_comment, transition_issue ✓

=== 3. idempotency — a retried decision writes once, then DUPLICATE ===
  external writes: 1 · audit rows: DUPLICATE, SUCCEEDED ✓

=== 4. redaction — a forced 401 stores and returns a scrubbed error ===
  returned: "Authorization: [redacted]"
  stored:   "Authorization: [redacted]"
```

Acceptance criteria, one line each: ON → `writeback_log` records `SUCCEEDED` rows
with a recovered `externalRef`; OFF → zero tool calls and zero rows; a retried
decision → one external write; a forced 401 → a redacted `FAILED` row with no
token bytes.

## What drifted (and how it was caught)

- **Migration 0033 emitted `public.`-qualified foreign keys.** drizzle-kit
  v0.31.10 autoqualified the `review_decisions` FKs as `REFERENCES
  "public"."review_reports"` / `"public"."review_decisions"`, which the
  isolated-schema test harness (search_path-scoped) rejects — the table is created
  unqualified into the test schema but the FK points at `public`. Caught by the db
  integration test, fixed by hand-editing 0033 back to unqualified references,
  matching migrations 0000–0030. 0031 carries the same latent quirk but is
  pre-existing and off the Week-2 path; worth a quiet sweep later.
- **The wiring map lagged the registrations.** `McpServerRegistry` (day-02) and
  `WriteBackService` (day-06) were registered in `bootstrap.ts` without map rows;
  the day-10 wiring-map pass added both — plus the `writeback_log` /
  `review_decisions` note and the `demo:writeback` root facade (day-09's
  `demo:writeback-toggle` facade had been missed too).

## Boundary check

- **No package leaked past its seam.** `writeback` consumed only the
  `WritebackLogStore` port from `@harness/domain` and the `McpServerRegistry` +
  `McpClient` types from `@harness/mcp`; the Drizzle implementation of the store
  lives in `@harness/db`, and the two are boundary-forbidden from importing each
  other. The architecture test + `eslint-plugin-boundaries` stayed green. No live
  token, no key, no base URL is present anywhere in the repo; `.env.example`
  documents `WRITEBACK_ENABLED=1` / `WRITEBACK_GITHUB=1` as commented placeholders
  only.

---

*Checkpoint rule applied: `pnpm typecheck` (44/44), `pnpm lint`, and `pnpm test`
(**745** tests / 134 files) are all green before this note is committed. The
stubbed demo runs end-to-end with no live token and no key in the repo.*

*Next: Day 11 — Clone a PR into a sandbox worktree (`GitProvider.cloneAndCheckout`). Week 3 pivots to verification breadth; the
write-back seam is closed at this checkpoint — do not start it back up early.*