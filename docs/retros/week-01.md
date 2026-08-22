# Week 1 Retro — Foundation

*Day 07 checkpoint. This is a private working document: honest by design, not a
rubber stamp.*

## What is solid

- **The state machine is the spec.** `TaskStateMachine` owns the transition
  table and nothing else can judge legality. The exhaustive 13×13 test asserts
  exact parity with `day-06 §2.2`, so a drift between doc and code fails CI, not
  silently.
- **Branded IDs keep cross-entity assignment a compile error.** A task id where a
  `CorrelationID` is expected, or a `TaskID` where a `ProjectID` is expected,
  fails the type checker. The `brand()` calls in the mappers and event
  correlation are explicit trust boundaries, not scattered casts.
- **The DI container is boring in the right way.** `bootstrap.ts` is ~90 lines,
  topological, and every dependency is visible in one place. `bootstrap.test.ts`
  resolves the whole graph against a stub, so a broken wire fails a unit test,
  not at boot.
- **Boundary enforcement is structural, not advisory.** `eslint-plugin-boundaries`
  rejects an engine importing a sibling engine at edit time; the architecture
  test asserts the same from the inside. Two independent guards on the same rule.
- **Test isolation is real.** `createTestDb` drops/recreates a per-suite Postgres
  schema and applies migrations into it, so the unit tests can't leave residue in
  the dev database.

## What is fragile

- **`EventLogWriter` is fire-and-forget with `console.error` as its only failure
  path.** For Phase 1's in-process, low-volume bus this is acceptable — but it is
  the one place where a write can be silently lost (a process crash between
  `publish` and the awaited insert, or a transient DB error that only lands in a
  log line nobody reads). Week 2's dispatch loop raises both volume and
  concurrency, so this is the first thing that will break meaningfully.
- **The smoke test borrows `drizzle-orm` directly in `apps/api`.** The app layer
  reaches past `@harness/db` to run a raw `event_log` query. It works, but it
  signals that read-model queries have no home yet — every consumer will grow its
  own Drizzle dependency unless a thin query layer lands in `@harness/db`.
- **`RETRYING` is a defined state with no arrows.** Deliberate (Day 10), but it
  means the union is 13 states while only 12 are reachable. Anyone switching on
  `TaskStatus` exhaustively will trip over it until Day 10 closes the gap.
- **`harness_test` isolation lives at the schema layer, not the database layer.**
  `createTestDb` walls tests via `search_path`, which works but is unusual
  enough that a future migration introducing a qualified reference (`public.x`)
  would silently re-point tests at the dev DB. This already bit once — the Day 06
  migration had to be hand-edited from `REFERENCES "public"."tasks"` to the
  unqualified form — and it won't be the last time.

## Decisions that need revisiting before Phase 2

- **Move `EventLogWriter` off fire-and-forget.** Either a dedicated write queue or
  a synchronous `write` on the hot path (profiled first). Decided *not* to change
  now — see checkpoint rule — but this is the highest-priority architectural debt
  carried into Week 2.
- **Where do read models live?** The `TaskRecord`/`TaskStateHistoryEntry` mappers
  are in `@harness/orchestrator`. If other engines need the same tables, those
  mappers (or the table module itself) should migrate to `@harness/db` rather
  than being re-derive-per-consumer.
- **`createTask` does not publish `task.created`.** The event type exists in
  `@harness/domain` but no one emits it yet. Decide at Day 08 whether task
  creation is a first-class event or a DB insert; provenance (Day 26) will want
  an answer.
- **`assigned_agent` is written by nobody.** The column exists (schema parity
  with the spec) but `TaskService` never sets it. Either the dispatch loop writes
  it at Day 08, or it is dead schema and should be flagged in the spec pass.

## Watch items for Week 2

- **Day 08 coroutine/dispatch loop** will be the first *author* of `TaskService`
  transitions at volume. Watch for transition ordering bugs (`StateConflictError`
  storms when two workers pull the same `QUEUED` task) — optimistic locking is
  correct but will need retry/backoff around it.
- **The stub `Proxy` engines** in `bootstrap.ts` are about to become real. When
  the first real engine registers, re-check the bootstrap order stays acyclic and
  keep `wiring-map.md` in lockstep.
- **Migration hygiene.** Every new table so far avoided qualified `public.*`
  references so schema isolation keeps working. Enforce that as a review check,
  not a hope.
- **Test DB count.** Each DB-touching suite spawns its own `postgres.js`
  connection (max 1). As the number of suites grows, watch for `too many clients`
  on the shared dev Postgres; consider a shared test pool if it shows up.

---

*Checkpoint rule applied: the smoke test, lint, typecheck, build, and full test
suite are all green before this note is committed (see `apps/api` on Day 07).*
---

# Phase 2 · Week 1 Retro — Identity & Observability

*Day-05 checkpoint (Phase 2). Separate pass over the identity + observability
stack built across Phase-2 days 01–04. Same rule as the Phase-1 retro: honest by
design, numbers-first, blameless — and every acceptance criterion is green
before this note is committed.*

## What is solid

- **Identity is `sub`-keyed, not email-keyed.** Provider-stable `oidc_sub` is the
  uniqueness anchor; `decisions.actor_id` / `event_log.actor_id` foreign-key to
  `User.id` (UUIDv7), so re-provisioning a user never rewrites history. Email is
  display data and allowed to drift.
- **Remove-header, not mask.** The Phase-1 `X-Reviewer-Id` / body-`reviewerId`
  path was fully removed in day 02; reviewer/actor identity comes only from
  `request.auth.user`. `grep -r "X-Reviewer-Id" apps packages` is clean (only
  doc-comments mention it, and those were reworded so the literal-token criterion
  is genuinely zero — no test needed masking).
- **The 403 is evidence, not silence.** `requireRole` publishes
  `authz.decision_denied`; `EventLogWriter` subscribes to *every* event type and
  persists it to `event_log`. A denied reviewer attempt is queryable, which is
  exactly what an audit trail should do.
- **The mock OIDC provider keeps the real exchange.** `getAuthorizationUrl` →
  follow twice → `code` → redeem → upsert → session. No fake cookie that "skips
  the redirect" — so what Week 2 measures is real identity.
- **Metrics are on a single process-global register** scraped by one `/metrics`
  endpoint, with bounded categorical labels (`route`, `was_useful`) only — the
  cardinality rule held end-to-end (no correlation/task/user keyed labels).

## What is fragile

- **`correlation_id = "bootstrap"` is the silent default for any span that
  escapes the async-local context** (`context.ts:46`). The tracer *test* pins the
  default, but nothing at runtime warns you that a span landed on it. Every such
  span pollutes Week-2 latency joins and reads as "one shared task" in a
  `WHERE correlation_id = 'bootstrap'` query. This checkpoint's demo is the last
  cheap place to find them — the retro's beat 3 explicitly greps for it.
- **Two metric families are registered but never emit.** `harness_context_resupply_total`
  is declared (the `requestAdditionalContext` seam **does not exist here yet**),
  and the six offline gauges stay silent until `@harness/evaluation` sets them on
  Day 06. That is by design, but a dashboard or alert wired to those names today
  would be misleading — zero samples is not "healthy". Watching until the emitter
  lands is the right posture, not wiring alarms to silence.
- **The usefulness `unknown` bucket only counts Phase-1 history.** `RequestWasUseful`
  is a required `boolean`, so an order-happy client always sends true/false; the
  `undefined → unknown` folding in `recordUsefulness` protects against callers
  that omit it, but today the unknown bucket is effectively empty. Before Day 11
  builds the calibration dataset the shape to re-verify is *which event* fires it
  and whether `null`-handling is off — a latent calibration bug is cheapest to
  kill now (plan §6).
- **Two metric surfaces coexist.** The Phase-1 `/api/ops/metrics` JSON and the new
  `/metrics` Prometheus scrape both answer "how healthy is review?". Deliberate
  and low-risk (the ops endpoint is being superseded), but two sources invite an
  operator to read the wrong one.

## Boundary check

- **No engine reached for another engine.** The `DiffProvider` seam is how review
  reads diffs without importing `@harness/artifact-tracker` (R6); observability's
  R8 locks it to shared infra. The architecture test enforces R4/R7/R8 from the
  real package manifests, so a future cross-engine import fails CI, not silently.

## Decisions / debts carried into Week 2

- **`context_resupply_total` + offline gauges are placeholders until Day 06** —
  keep them registered (they're the alphabet for evaluation) but don't wire
  dashboards/alerts until the emitter sets real samples.
- **The `bootstrap`-correlation watchdog is unfunded** — a cheap step is a log (or
  span tag) when a *non-root* decision-path span resolves to `bootstrap`, rather
  than assuming the async-local store is always set.

---

*Checkpoint rule applied: lint, typecheck, all 384 unit/integration tests, and the
E2E happy-path + 8 failure scenarios are green before this note is committed.
R7/R8 and the no-engine-imports-engine rule are asserted by
`packages/di/src/__tests__/architecture.test.ts`.*
