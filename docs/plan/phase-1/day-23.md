# Day 23 — E2E vertical slice — happy path (PR → report → decision)

| | |
|---|---|
| **Week** | W4 — Human loop + E2E |
| **Spec refs** | Spec 1 §2 (core loop), plan README §7 (scripted demo) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 22 (UI) + Days 12–21 (backend slice) |

---

## 1. Objectives

- Prove the **happy path** end-to-end with a scripted E2E: paste PR URL → fetch diff + requirement → AI review → verification evidence → attention label → human decision, all queryable by provenance.
- Drive the API-level E2E (super-scripted, deterministic via `MockLLM` + fixtures) and assert every hop's record.
- Verify the UI can walk the same path against the running system (browser-level smoke where feasible, otherwise scripted API + UI build).
- Freeze the demo narrative ("AI reviews, never writes") used in the Day 29 demo.

## 2. Design Decisions

- The happy path is one assertion chain over `correlation_id`, proving provenance is not just aspirational.

```text
GET  /health → POST /api/reviews { prUrl, ticketUrl }
→ report created → verification.completed → attention.item_routed
→ POST /api/reviews/:id/decision { decision: 'APPROVED' }
→ provenance query returns [pr_fetched, report_created, verification.completed,
                            item_routed, decision_submitted]
```

- No live GitHub/LLM: fixtures for the PR/diff, `MockLLM` for the review, fixture sandbox for verification — the demo is reproducible on a clean checkout.

## 3. Tasks

### 3.1 Happy-path E2E (180 min)
- [ ] `apps/api/test/happy-path.e2e.ts` — full chain with deterministic mocks/fixtures
- [ ] Assert the provenance event order under one `correlation_id`

### 3.2 Demo script (120 min)
- [ ] `scripts/demo-review.ts` printing each hop + links to query UI
- [ ] `README` happy-path quickstart verified

### 3.3 UI smoke (120 min)
- [ ] Browser-level smoke (or API+built-UI walk) against the running stack

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/test/happy-path.e2e.ts` | Happy-path E2E |
| `scripts/demo-review.ts` | Scripted demo runner |
| `fixtures/pr/happy-path.json` | Deterministic fixture bundle |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/api test` passes the happy-path E2E
- [ ] The happy path returns a report with findings + suggestions and a recorded `APPROVED` decision
- [ ] Provenance query returns the ordered chain under one `correlation_id`
- [ ] The demo runs with no live keys or network-dependent LLM

## 6. Notes & Pitfalls

- Order the E2E around the *event log* (append-only), not current-state tables — that's where provenance actually lives.
- Re-run is idempotent: a second identical request reuses the report, not duplicating it.

---

*Next: [Day 24 — E2E — failure paths + provenance query UI](day-24.md)*