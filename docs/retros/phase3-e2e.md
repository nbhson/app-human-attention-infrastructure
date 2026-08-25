# Phase 3 · E2E Retro — 9 tests, real internals, stubbed externals, green at rest

*Day-37 exit evidence (Phase 3). Week 8's "everything together" checkpoint is
written as one recorded golden-path run plus the branches that carry the
discipline, then a concurrency probe that proves isolation and teardown. The
discipline is unchanged from every prior milestone: the E2E may stub only the
external hosts (Git/Ticket/LLM/MCP transports) — the DB, event bus, memory,
verification, judge and write-back run for real — and it must pass under the
**safe** at-rest defaults (write-back off, no live keys), not a demo-max config.
The day ends **green before committed**: `pnpm e2e` 9/9, `pnpm test` 969/969,
`pnpm lint` clean. Numbers-first, blameless.*

## What shipped today (Day 37)

- **`e2e/full-system.spec.ts`** — one golden-path run (`POST /api/reviews` →
  `ReviewIngestService` → DB/bus → memory → judge → write-back) plus the three
  forced branches, 6 tests. Real Postgres (`@harness/db/test-utils` isolated
  schema), real event bus, real memory store, real judge, real verification
  engine; Git/Ticket/LLM are in-memory stubs.
- **`e2e/load-profile.spec.ts`** — correctness-under-concurrency, 3 tests: 10
  simultaneous full-system reviews landing distinct rows, 10 interleaved
  GitHub+GitLab ingests resolving their own hosts, and a sandbox-teardown
  assertion.
- **`e2e/vitest.config.ts`** — a deliberately separate runner (`include:
  e2e/**/*.spec.ts`), so `pnpm test` (unit) and `pnpm e2e` (full-system) stay
  independent. Maps each `@harness/*` import straight to its built `dist` entry,
  since the root-level specs have no workspace `node_modules` symlink to follow.
- **`pnpm e2e` wired into the root `package.json`**, and `e2e/*.ts` added to
  `eslint.config.mjs`'s `allowDefaultProject` so the specs remain type-aware-linted.

## The golden path, demonstrated

One review, real internals end-to-end, with each stage asserted through its own
table/event stream rather than a log line: the report lands in `review_reports`
with its findings and suggestions (readable back over `GET /api/reviews/:id`), the
shadow judge scores it into `judge_runs` (measurement only — no decision row ever
appears), and the memory write→read round-trip resolves the same entry together
with its `memory_entry_evidence` link. Stub-tripwires throw if the LLM script runs
dry or a provider is asked to `postComment`/`cloneAndCheckout` in the read-only
path, so a hole in the seam fails loudly instead of passing silently.

## Branch coverage is the real E2E value

The three branches the plan names as the value of the day are exercised and
asserted, not assumed:

- **Verification FAILED is non-blocking.** A forced failing check, passed through
  the real `flagReport`/`renderFlag` machinery, yields a `FAILED` flag that is a
  *report, not authority*: it carries an evidence ref and the "review required
  before write-back" gate, and holds no `decision` field — a red verify annotates
  rather than auto-rejects.
- **Write-back OFF produces provably nothing external.** An APPROVE with
  `writeback:true` under an unset `WRITEBACK_ENABLED` ceiling resolves to
  `writeback:false` at the route (the three-layer gate), the decision row records
  `writeback_enabled=false`, and the recording write-back service is asserted to
  have zero intents — "nothing external" is an auditable fact, not an absence.
- **Judge is shadow-only.** The shadow judge fired after `review.report_created`,
  scored the report into `judge_runs`, and mutated neither the report nor any
  decision — it observes, it does not decide (the plan's "HOLD" branch, realized
  as shadow measurement with no authority).

A single green happy path proves little; these three are where the "automation
stops at the human gate" discipline actually lives.

## Load profile = isolation + teardown

Two seams, ten reviews apiece, correctness under concurrency:

- **Isolation (no config/token bleed).** Ten concurrent full-system reviews land
  ten distinct report ids with ten distinct repos and matched `pr_number`s; the
  provider stub was asked exactly the ten repos/numbers, so nothing crossed.
  The multi-host facade then proves the other half: ten interleaved GitHub+GitLab
  ingests each resolve their **own** host and number, and any tool call the host
  does not own is a tripwire.
- **Teardown (no leaked sandbox).** After the concurrent runs, `SANDBOX_ROOT`
  is asserted empty — the read-only review slice clones nothing, so "no leaked
  workdir" is an emptiable fact, not an absence we hope for.

## Safe defaults at rest

The E2E runs with `WRITEBACK_ENABLED` **unset** (off) and no live host keys:
the Git/Ticket providers are in-memory stubs, the LLM is a scripted mock, and the
sandbox CLI is a stub returning fixed output. The spec deletes `WRITEBACK_ENABLED`/
`WRITEBACK_GITHUB` and re-asserts the recording write-back is empty, so a default
that later flips on by mistake fails the suite rather than nudging a live host.

## The invariants, and what holds them

- **Stubbed externals, real internals.** Only Git/Ticket/LLM/MCP are stubbed; DB,
  event bus, memory, judge, verification and write-back all run for real against
  an isolated Postgres schema.
- **No live keys, no sandbox escape.** The suite is keyless and hermetic; each
  file owns an `mkdtemp` sandbox root that is `rm`'d and asserted empty.
- **Isolated schemas.** Each spec uses its own schema name; `beforeEach` deletes
  rows in FK order, so runs are reproducible and self-cleaning.
- **Unit and E2E stay independent.** Separate `vitest.config.ts` files mean the
  969-test unit suite never collects the full-system specs, and vice versa.

## The debt carried forward

- **Verification is exercised at the flag seam, not the container.** The E2E
  proves the `flagReport`/`renderFlag` non-blocking invariant over a forced FAILED
  check set; a real-container verification pass (clone → `pnpm build`/`pnpm test`
  in the Docker sandbox) belongs to the benchmark/evaluation harness with the
  image pre-built, not to the keyless E2E (mirroring how `sandboxed-check.test.ts`
  covers the container path out-of-band).
- **Volume is a demonstration, not a population.** Ten concurrent reviews prove
  isolation and teardown; stress is explicitly out of scope per §2.2 of the plan.

## Acceptance criteria

- [x] `pnpm e2e` green end-to-end (real internals, stubbed externals only) — 2 files / 9 tests.
- [x] FAILED verification non-blocking, write-back OFF, and judge HOLD branches all asserted.
- [x] Concurrent reviews show no config/token bleed + no sandbox leak.
- [x] E2E passes under safe (off-at-rest) defaults — write-back OFF, no live keys.
- [x] `pnpm test` (969/969, 166 files) + `pnpm lint` (clean) + `pnpm e2e` (9/9) green.

---

*Next: Day 38 — Docs: Specs to v1.0 Candidates, Runbook + Dev Guide*