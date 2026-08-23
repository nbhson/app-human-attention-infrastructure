# Day 26 — Hardening: concurrency, failure injection, load smoke

| | |
|---|---|
| **Week** | W4 — Human loop + E2E |
| **Spec refs** | Spec 1 §5 (modular core), §7 (reject, don't infer) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 25 (observability + correlation) |

---

## 1. Objectives

- Harden the ingest/review pipeline against concurrency: concurrent reviews of the same PR, duplicate correlation IDs, and simultaneous decision writes must not corrupt state.
- Add **failure injection** (kill the DB, provider timeout, LLM error, verification crash) and assert each degrades cleanly rather than hanging or half-writing.
- Run a **load smoke** (bounded concurrency burst) to confirm the stack stays healthy and each request keeps its own `correlation_id`.

## 2. Design Decisions

- Concurrency safety comes from the existing invariants: idempotency-by-correlation (Day 12), optimistic `TaskService` version guards (Day 06), and append-only writes — hardening verifies them under load, it doesn't bolt on locks.

```text
failure latte: DB down → 503 & redacted; provider timeout → 504; LLM error → 502;
               verification crash → verification.completed(status: ERROR), review still recorded
```

- A failure is *recorded*, never swallowed: a crashing verification still writes an `ERROR` evidence row so the review carries the gap honestly.

## 3. Tasks

### 3.1 Concurrency tests (120 min)
- [ ] Concurrent `POST /api/reviews` on the same PR reuses one report (no dupes)
- [ ] Concurrent decisions on one review resolve without lost updates

### 3.2 Failure injection (180 min)
- [ ] `apps/api/test/failure-injection.e2e.ts` — DB down, provider timeout, LLM error, verification crash
- [ ] Assert clean error codes + recorded `ERROR`/`TIMEOUT` evidence

### 3.3 Load smoke (120 min)
- [ ] Bounded burst worker hitting ingest; assert success rate + correlation integrity + no half-writes

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/test/concurrency.e2e.ts` | Concurrency tests |
| `apps/api/test/failure-injection.e2e.ts` | Failure injection |
| `scripts/load-smoke.ts` | Bounded-burst smoke tool |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/api test` passes concurrency + failure-injection suites
- [ ] Concurrent same-PR reviews produce exactly one report; decisions don't double-apply
- [ ] Each injected failure surfaces the correct status code + recorded evidence (no hangs, no half-writes)
- [ ] The load smoke keeps every request on its own `correlation_id`

## 6. Notes & Pitfalls

- Timeouts everywhere (provider, LLM, verification) — a hung check must fail, not stall ingest indefinitely.
- No half-writes: report + findings + suggestions commit atomically (from Day 12), so a failure mid-write leaves nothing orphaned.

---

*Next: [Day 27 — Provider config hygiene: token redaction, sanitized env, no live keys](day-27.md)*