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