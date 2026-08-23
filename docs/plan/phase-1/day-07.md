# Day 07 — Week 1 checkpoint — E2E smoke test

| | |
|---|---|
| **Week** | W1 — Foundation |
| **Spec refs** | Spec 1 §7 (invariants), plan README §6 (checkpoints) |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 01–06 (domain, events, db, di, state machine) |

---

## 1. Objectives

- Integrate Week 1 packages into one bootable `apps/api` process — domain + bus + db + di + orchestrator wired through the composition root.
- Prove the foundation with an E2E smoke test: boot → create a task → transition `PENDING → CANCELLED` → assert the bus emitted and `event_log`/`task_state_history` recorded the hops.
- Make `docker compose up && pnpm dev` bring the whole Week 1 slice up from a single command.
- Fix any integration debt surfaced by wiring (not by adding features) before Week 2 starts.

## 2. Design Decisions

- The checkpoint is a **stop-feature-work gate**: the week's slice must be demonstrable. This smoke test walks the foundation end-to-end but deliberately does not yet fetch a PR or call an AI — that is Week 2.
- One shared `vitest` integration harness boots the container + DB once per run (migrate → seed → exercise → assert), using a throwaway database.

```ts
// smoke flow (assertive, non-mutating beyond the log)
await bootstrap();                       // container + migrate
const task = await taskService.createTask({ projectId, title: 'anchor' });
await taskService.transitionTask(task.id, 'CANCELLED', { rationale: 'smoke' });
// assert: task.state_changed on bus + event_log row + task_state_history row
```

## 3. Tasks

### 3.1 Bootstrap + wiring (120 min)
- [ ] Complete `apps/api/src/bootstrap.ts` resolving all Week 1 services
- [ ] `/health` reports DB reachable + migrated

### 3.2 E2E smoke (150 min)
- [ ] `apps/api/test/smoke.e2e.ts` running create → cancel → assert events/history/log
- [ ] Dockerized postgres used by the test (or a fixture config)

### 3.3 Integration debt (90 min)
- [ ] Log correlation IDs on each event; consistent env loading (`.env.example`)
- [ ] `README` quickstart commands verified end-to-end

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/bootstrap.ts` | Complete Week 1 composition root |
| `apps/api/src/server.ts` | Fastify app + `/health` |
| `apps/api/test/smoke.e2e.ts` | Foundation smoke test |
| `apps/api/.env.example` | Placeholder-only env config |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/api test` passes the E2E smoke
- [ ] `docker compose up && pnpm dev` boots the API with a migrated, reachable DB
- [ ] The smoke run asserts a `task.created` + `task.state_changed` pair joined by one `correlation_id`

## 6. Notes & Pitfalls

- Treat the checkpoint as a demo: if anything is wiring-only creep, defer it — do not silently skip a failing acceptance criterion.
- Keep the API surface minimal today; routes arrive Days 13/23.

---

*Next: [Day 08 — GitProvider seam + GitHubProvider (fetch PR diff/metadata)](day-08.md)*