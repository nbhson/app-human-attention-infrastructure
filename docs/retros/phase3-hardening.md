# Phase 3 · Hardening Retro — Secrets never touch a log, and a write-back fires exactly once

*Day-36 checkpoint (Phase 3, Week 8). Hardening is the pass that stops trusting the
seams Day 08 and Day 03 built and starts attacking them. Three invariants carry the
day, each stated in the negative the acceptance criteria use: **no duplicate external
write** under fault injection, **no token byte** on any surface a failure reaches, and
**no cross-host bleed** when two providers interleave. The audit closed one real gap —
a concurrent-double-write window in the write-back idempotency index — rather than
documenting it. Green before committed: 969 tests / 166 files, lint clean, and a
`git grep` for live keys that returns only deliberate placeholders.*

## What hardened this pass

- **Write-back idempotency, attacked (not trusted).** Day 08 shipped a partial unique
  index; today fault-injection proves the negative. The gap found and closed is real:
  the index previously scoped to `status = 'SUCCEEDED'` only, so **two racing PENDING
  claims** for the same intent could both proceed to the external host — a second
  comment. The fix widens the index to `IN ('PENDING','SUCCEEDED')` and rewrites
  `claim` on `ON CONFLICT DO NOTHING`, so a racing or crashed identical claim resolves
  to `duplicate` *before any external call*. A `FAILED` row leaves the index, so a
  retry after a genuine failure still reaches the host (retry-after-failure is safe:
  no write happened).
- **Token redaction, made a tested invariant.** The redaction sweep makes a write-back
  fail on purpose by bouncing the very `Authorization` header back, then greps every
  surface the failure reaches — the returned error, the `writeback_log.error`/`body`
  columns, and the `provider_configs.token_redacted` mirror — and asserts no secret
  byte survives. Crucially it seeds one secret that matches **no** regex (an arbitrary
  env value), so the literal env-value scrub (`credentialEnvValues`) is proven, not
  just the Bearer/token/`ghp_`/`xox`/`AKIA` patterns. The mask (`[redacted]`) is
  asserted present, so the sweep proves the *mask*, not the absence of a string that
  was never there.
- **Multi-provider concurrency, proven as routing isolation.** Two interleaved reviews
  (GitHub + GitLab) resolve their own registry entry, their own tool names, and their
  own argument shapes — and the tripwire asserts **which host a request did not hit**:
  each fake client throws on an out-of-scope tool name, so a "wrong token used" bug
  surfaces as a failure rather than a silent success. A host absent from the registry
  fails loudly (`gitlab` never rides `github`).

## The day-36 bug (§2.1): a gap, closed

The old index `(dedup_key) WHERE status = 'SUCCEEDED'` prevented double-*recording*
but not double-*calls*: two identical `claim`s racing before either finalized both
resolved `claimed` (both PENDING rows are outside the `SUCCEEDED` predicate), so both
proceeded to post a comment. The plan's own note — *"any path that produces a second
external comment is a bug to close, not document"* — forbade the easy route of
papering over it with a test-only "two claims both claimed" assertion.

The fix has three parts, each mirroring the other two:

- **Schema** (`packages/db/src/schema/writeback-log.ts`): the partial unique index is
  now `(dedup_key) WHERE status IN ('PENDING','SUCCEEDED')`, renamed
  `writeback_log_dedup_inflight_uniq` — the *in-flight* serialization point.
- **Store** (`packages/db/src/writeback-log-store.ts`): `claim` inserts `PENDING` with
  `ON CONFLICT DO NOTHING` targeting that index; `attempted.length === 0` means a
  racing/prior identical claim holds the key, so it records the audit `DUPLICATE` skip
  and returns `duplicate` — never reaching the host. (A `try/catch` on the unique
  violation is *not* sufficient: Postgres aborts the transaction on any error, so the
  follow-up `DUPLICATE` insert would be ignored — `ON CONFLICT DO NOTHING` is the
  atomic path.)
- **Proof** (`packages/writeback/src/__tests__/idempotency-fault.test.ts`): a
  `ConcurrencySafeStore` modelling the fixed semantics is attacked by (a) three
  concurrent identical intents → one call, `[SUCCEEDED, DUPLICATE, DUPLICATE]`; (b) a
  claim that crashes before finalize → the retry is a no-op, zero calls; (c) a
  genuinely failed attempt → retry re-reaches the host (2 calls, `[FAILED, SUCCEEDED]`);
  (d) a whitespace-reformatted retry → one call; (e) two different bodies → two calls.

The real serialization point in production remains the Postgres unique index, proven
standalone by `packages/db/src/writeback-log-store.test.ts` (migration `0041`).

## The key-hygiene audit (§3.4)

`git grep` for live-key patterns across the repo returns **four** hits, and all four
are deliberate placeholders, not secrets:

- `apps/api/scripts/demo-writeback.ts` and `packages/writeback/src/__tests__/mcp-writeback.test.ts`
  — `ghp_abcexampletoken12345`, a 20-char string that literally spells "example token"
  (real `ghp_` tokens are 36 chars), used to prove redaction of a leaked header.
- `packages/writeback/src/__tests__/redact.test.ts` — `ghp_abcdefghijklmnop` (a
  sequential alpha fixture) and `AKIAIOSFODNN7EXAMPLE` (AWS's canonical, documented
  non-working example access key ID).

No `sk-ant-` key, no `xox[baprs]-` token, no private key, no `ghp_`/`AKIA` of real
length exists anywhere in the tree. `.env.example` carries only `your-…-here` / `…-insecure`
placeholders (and `minioadmin` for the local MinIO dev store). The real Anthropic path
remains compile-tested only; no live key has ever been committed.

## The invariants, and what holds them

- **A write-back fires exactly once.** The in-flight index scopes `PENDING + SUCCEEDED`,
  `claim` is an atomic `ON CONFLICT DO NOTHING`, and the fault suite asserts one
  external call across concurrency, crash, and reformat.
- **No token byte reaches a log, event, or error.** `redactSensitive` + the
  env-literal scrub run inside the service before any surface is written; the sweep
  proves it at the persistence boundary for both a pattern secret and a non-pattern
  secret, and requires the mask to be present.
- **Concurrency is config isolation.** Each review resolves its provider from its own
  registry entry; the isolation test asserts *which host* and *which tools* a request
  hit, and that a missing host fails loudly rather than borrowing a neighbor.
- **No live key, no sandbox escape.** The audit is clean to deliberate placeholders;
  the real keys and the Docker sandbox path stay compile-tested only.

## The debt carried forward

- **The token at rest is a last-4 hint, not encrypted.** `provider_configs.token_redacted`
  stores only a non-reversible hint (the full token lives in the MCP server's env,
  injected at connect time). Full encrypt-at-rest of any persisted secret remains a
  follow-up if a provider ever needs the harness to hold a token beyond the hint.
- **Redaction is proven on the failure path, not exhaustively on every endpoint.** The
  sweep covers write-back (the public write seam); extend the same tripwire to any
  future route that echoes provider state.
- **Days 37–40:** E2E full system under Phase-3 infra + load profile, then the exit
  review.

## Acceptance criteria

- [x] No duplicate external write under concurrent retry / crash / reformat (`idempotency-fault.test.ts`).
- [x] Token bytes absent from every event, error body, and log row (`redaction-sweep.test.ts` green, mask asserted).
- [x] Two interleaved reviews across two providers resolve independent configs with no bleed (`concurrency.test.ts`).
- [x] No live key committed anywhere (`git grep` clean to deliberate placeholders only).
- [x] `pnpm test && pnpm lint` green (969 tests / 166 files).

---

*Next: [Day 37 — E2E Full System under Phase-3 Infra + Load Profile](../plan/phase-3/day-37.md)*