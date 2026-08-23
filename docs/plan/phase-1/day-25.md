# Day 25 — Observability: logs, correlation IDs, audit queries

| | |
|---|---|
| **Week** | W4 — Human loop + E2E |
| **Spec refs** | Spec 1 §5 (everything observable), §7 (append-only audit) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 24 (provenance query + failure paths) |

---

## 1. Objectives

- Standardize structured logs across the API with a **correlation ID** threaded through every request/hop.
- Ensure the `event_log` is the audit backbone: every meaningful operation (fetch, report, verification, routing, decision) is queryable and reconstructible.
- Add audit queries (by `correlation_id`, by review, by decision type, by time window) for operators.
- Emit logs in a parseable format (JSON lines) with redaction hooks ready for Day 27.

## 2. Design Decisions

- One logger, one envelope: `{ ts, level, msg, correlation_id, event_type?, ...context }`, with `correlation_id` inherited by the bus handlers so a single review is a single trace.

```ts
logger.info('review.report_created', { correlation_id, report_id, verdict });
// emitted both as a log line AND an event_log row (same id)
```

- Audit = replay from `event_log`: the log is the source of truth, logs are a fast-index mirror, never a second truth.

## 3. Tasks

### 3.1 Logger + correlation (120 min)
- [ ] `packages/observability` (or `apps/api` logger) — JSON-lines logger + correlation middleware
- [ ] Fastify hook attaching `correlation_id` to request + downstream events

### 3.2 Audit queries (150 min)
- [ ] `apps/api/src/routes/audit.ts` — filter by correlation/review/decision/time
- [ ] Index/support for time-window + decision-type queries

### 3.3 Tests (90 min)
- [ ] Correlation ID passes request → fetch → report → decision; audit query returns the ordered set

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/observability/logger.ts` | Structured JSON logger |
| `apps/api/src/observability/correlation.ts` | Correlation middleware/hook |
| `apps/api/src/routes/audit.ts` | Audit-query endpoints |
| `apps/api/test/observability.e2e.ts` | Correlation + audit tests |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/api test` passes observability E2E
- [ ] One request produces one `correlation_id` across all its logs + event rows
- [ ] An audit query by review id returns the full ordered operation chain
- [ ] Log lines are valid JSON and carry a level + correlation id

## 6. Notes & Pitfalls

- Logs carry ids and statuses, never secrets — the redaction rule lands hard on Day 27.
- Keep `event_log` the durable record; tune the log mirror, don't store truth there.

---

*Next: [Day 26 — Hardening: concurrency, failure injection, load smoke](day-26.md)*