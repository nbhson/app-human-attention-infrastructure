# Day 14 — Week 2 checkpoint — review vertical slice (GitHub + real/mock LLM)

| | |
|---|---|
| **Week** | W2 — Review ingest core |
| **Spec refs** | Spec 1 §2 (core loop), plan README §2 (vertical slice) |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 08–13 (providers, ReviewAgent, ingest, routes) |

---

## 1. Objectives

- Demonstrate the Week 2 vertical slice: paste a PR URL (+ Jira) → fetch diff + requirement → AI review → persisted report with findings + suggestions → human decision recorded.
- Run the slice against **both** the real provider paths (compile/runtime via fixture transport) and `MockLLM`, proving the seam is real but tests stay keyless.
- Make the checkpoint demoable from one command (`pnpm dev` + the fixture PR), with provenance (fetch → report → decision) queryable in the DB.
- Fix integration debt from wiring providers + agent + ingest into the API.

## 2. Design Decisions

- The checkpoint proves the **review loop**, not code generation: the only git operation is a read (`fetchPullRequest`), the only AI operation is a review producing output. There is no write-back.
- Real-provider paths are exercised only against recorded fixtures (GitHub) and compile-tests (OpenAI-compatible) — no live keys or paid LLM calls in CI; `MockLLM` drives the demo deterministically.

```text
PR URL + ticket  →  fetch diff + requirement  →  ReviewAgent (read-only)
                 →  ReviewReport (+ findings, + suggestions)  →  decision
```

## 3. Tasks

### 3.1 Slice integration (150 min)
- [ ] End-to-end handler wiring ingest + routes; seed a fixture PR into the demo flow
- [ ] A scripted `mock` demo produce a deterministic report in the DB

### 3.2 Provenance query (90 min)
- [ ] Query joining `review_reports` → `event_log` (by `correlation_id`) → decisions
- [ ] Assert fetch → report → decision chain in a slice test

### 3.3 Debt + demo script (120 min)
- [ ] `scripts/demo-review.ts` walkthrough; README instructions; fix any wiring-only issues

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/routes/reviews.ts` | (completed) slice endpoints |
| `apps/api/test/review-slice.e2e.ts` | Week 2 vertical-slice test |
| `scripts/demo-review.ts` | One-command demo |
| `fixtures/pr/example-diff.json` | Demo PR fixture |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/api test` passes the vertical-slice E2E with `MockLLM`
- [ ] The demo yields a persisted `ReviewReport` reachable by `GET /api/reviews/:id` with findings + suggestions
- [ ] Provenance query shows `pr_fetched → report_created → decision_submitted` in order under one `correlation_id`
- [ ] No live key is referenced in tests or the demo script

## 6. Notes & Pitfalls

- This is a *checkpoint*, not a feature sprint: stop and demonstrate; defer new providers (GitLab/Bitbucket) and any write-back — they are Phase 3.
- Ensure the "AI never writes code" framing holds in the demo narrative and the UI copy.

---

*Next: [Day 15 — Verification Engine: request handler + compile check (CompileCheck)](day-15.md)*