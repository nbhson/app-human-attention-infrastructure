# Day 12 — ReviewIngestService — parse PR URL → fetch → create task (CANCELLED) → review → persist

| | |
|---|---|
| **Week** | W2 — Review ingest core |
| **Spec refs** | Spec 1 §2 (core loop), §7 (provenance via task anchor) |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 08–11 (providers + ReviewAgent + db) |

---

## 1. Objectives

- Build the `ReviewIngestService` that runs the review ingest path end-to-end: parse the PR URL, `GitProvider.fetchPullRequest` + `TicketProvider.fetchIssue`, `TaskService.createTask` (driven to `CANCELLED`), `ReviewAgent.review`, persist.
- Persist the AI result to `review_reports` + `review_findings` + `fix_suggestions`, joined by one `correlation_id`.
- Emit ingest + review events (`integration.pr_fetched`, `integration.ticket_fetched`, `review.report_created`, `review.finding_created`, `review.fix_suggestion_created`) on the bus.
- Make the path idempotent-by-correlation: re-running the same request reuses/links the same provenance record rather than duplicate-reviewing.

## 2. Design Decisions

- The task in this slice is a **provenance anchor only**: `createTask` then immediately `transitionTask(..., 'CANCELLED')`. The retired `EXECUTING → VERIFYING` code-gen workflow is **never** invoked — this path does not dispatch, run a workflow, or retry.

```ts
// ingest shape (no code-gen step anywhere)
parse(prUrl)                     // owner/repo/number
→ git.fetchPullRequest(prUrl)    // diff + metadata
→ ticket.fetchIssue(ticketUrl)   // requirement
→ taskService.createTask(...) → transitionTask(id, 'CANCELLED', rationale: 'review-anchor')
→ reviewAgent.review({ diff, requirement })
→ persist(report + findings + suggestions, correlation_id)
→ bus.emit(review.report_created, ...)
```

- The ticket is optional: a PR without a linked Jira still reviews against diff-only context (a `MissingTicket` warning event records the gap). All steps share `correlation_id` so the report is traceable to the fetch events.

## 3. Tasks

### 3.1 Ingest orchestration (180 min)
- [ ] `apps/api/src/services/review-ingest-service.ts` — the read → review → persist pipeline
- [ ] Optional-ticket handling + correlation propagation

### 3.2 Persistence binding (120 min)
- [ ] Bind `ReviewAgentOutput` to `review_reports`/`review_findings`/`fix_suggestions` via `@harness/db`
- [ ] Idempotency: reuse existing report when `correlation_id` already resolved

### 3.3 Events + tests (120 min)
- [ ] Emit ingest/review events in order; integration test with `MockLLM` + fixture PR diff
- [ ] Assert `CANCELLED` transition (with rationale) and the absence of any dispatch call

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/services/review-ingest-service.ts` | Ingest orchestration |
| `apps/api/src/services/review-ingest-service.test.ts` | Fixture-driven integration test |
| `apps/api/src/services/idempotency.ts` | Correlation-keyed dedupe |
| `fixtures/pr/example-diff.json` | Sample ingested diff |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/api test` passes the ingest integration test with `MockLLM`
- [ ] A PR URL + ticket URL produces one `review_reports` row with N findings + M suggestions and a recorded `CANCELLED` task
- [ ] `review.report_created` carries the same `correlation_id` as `integration.pr_fetched`
- [ ] Re-running the same correlation does not create a second report

## 6. Notes & Pitfalls

- Do **not** reference the retired dispatcher/workflow/retry loop in code, tests, or docs — the task's only meaningful transition today is into `CANCELLED`.
- Keep persistence transactional (report + children) so a partial write can't leave orphaned findings.

---

*Next: [Day 13 — POST/GET /api/reviews + decision route](day-13.md)*