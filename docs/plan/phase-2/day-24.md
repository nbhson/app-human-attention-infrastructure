# Day 24 — Promote Spec 8: Human Review Interface (Standalone Spec)

| | |
|---|---|
| **Week** | 5 — Sandbox, object store, Spec 8 |
| **Spec refs** | Spec 8 (new standalone); Spec 6 §4.1 (alert fatigue / review load), Spec 6 §4 (decision records); Phase-1 `@harness/review` backend; Spec 5 §4.2 (review-report `ContentStore`, Day 23) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 23 (review-report storage behind `ContentStore`); Phase-1 review backend (queue, `review.decision_submitted`, dwell metrics from Day 4) |

---

## 1. Objectives

By end of day you will have:

1. A **standalone Spec 8 — Human Review Interface** (`docs/core/8_Human_Review_Interface_v0.1.md`) that consolidates the review surface, which until now lived *implicitly* across the Phase-1 `@harness/review` backend, the attention engine's escalation path (Spec 6), and Day-23's pinned review-report storage.
2. The review **state machine + finite transitions** written down as a contract (queue → claimed → deciding → `submitted` → `applied`/`dismissed`), because an unstated state machine can't be audited and Day-28 will need to spec the interface to read it.
3. The **OPERATOR/REVIEWER/ADMIN role+permission split** from Days 1–2 reconciled with the interface's write operations (who can claim, decide, and escalate).
4. A **front-end interface spec** (not implementation): the actions a reviewer can take, the data each queue item must show (change diff, attention assessment, verification evidence, calibration confidence, and the pinned review report), and the dwell/decision telemetry each action emits.

Day 24 is a *promotion*, not a greenfield build: the backend exists; today makes its contract explicit so the interface is an engineering artifact (versioned, cited), not folklore.

---

## 2. Design Decisions

### 2.1 What Spec 8 owns vs references

| Concern | Owned by | Referenced from |
|---------|----------|------------------|
| Review queue + transitions | **Spec 8** | `@harness/review` backend |
| Decision record (`actor_id`, verdict, reason) | **Spec 8** (schema contract) | `review_decisions` (Day 2) |
| Review-report display (pinned, hash-verified) | **Spec 8** (display contract) | Day 23 `ReviewReportStore` |
| *What* gets escalated (attention ≥ threshold) | Spec 6 | Spec 8 §escalation |
| Dwell/decision telemetry | **Spec 8** (metric contract) | Day 4 counters |
| Auth on every action | Spec 8 (requires `requireRole`) | Day 2 |

The promotion extracts the *interface* (states, actions, data contract, roles, telemetry) into one numbered spec, and leaves *heuristics* (what's reviewable) in Spec 6. The line matters: Spec 8 says *how a human acts*; Spec 6 says *what deserves a human*.

### 2.2 The review state machine (normative)

```text
queued ──claim──▶ in_review ──decide──▶ submitted ──apply──▶ applied
   │                  │                      └───dismiss──▶ dismissed
   │                  └───escalate──▶ escalated (back to queued w/ raised attention)
   └───expire (timeout)──▶ queued (re-queued, claim released)
```

Each transition emits an event (`review.item_claimed`, `review.decision_submitted`, `review.item_escalated`, `review.item_released`) and is the *only* legal transition (finite state, no `applied → deciding`). Unstated today: what happens to an item when a claim times out. Spec 8 makes `expire → queued` explicit so no item is silently orphaned in `in_review`.

### 2.3 Decision schema contract

```sql
-- referenced (already exists from Day 2); Spec 8 freezes the contract
review_decisions (
  id text PK, review_item_id text NOT NULL,
  actor_id text NOT NULL,             -- from unified identity (Day 1/2)
  verdict text NOT NULL,              -- 'accept' | 'reject' | 'AUTO_APPROVED' | 'escalate'
  reason text NOT NULL,               -- required for reject; optional for accept
  decided_at timestamptz NOT NULL,
  sampled_for_audit boolean           -- Day 14's sampling flag
)
```

Spec 8 records the `verdict` vocabulary (now including `AUTO_APPROVED` from Day 14) as a closed enum with a CHECK, and requires `reason` on every `reject` (otherwise a rejection is un-actionable).

### 2.4 The front-end interface spec — actions, data, telemetry

Spec 8 sections enumerate, as a contract (not mockups):

- **Actions**: `claim`, `decide(accept|reject|escalate)`, `release`. Each spec'd with required role, allowed states, and the event it emits.
- **Display contract**: a queue item must render change diff, attention assessment (`priority` + `label`), verification evidence (`verification_reports`), calibration confidence (Day 12), and the pinned review report (Day 23, hash-verified); missing evidence must be *shown as missing*, not omitted.
- **Telemetry contract**: `claim` starts a dwell timer (Day 4's `review_dwell`); `decide` emits `review.decision_submitted` with `actor_id` (Day 2) and `sample` flag (Day 14).

---

## 3. Tasks

### 3.1 Draft Spec 8 (135 min)

- [ ] `docs/core/8_Human_Review_Interface_v0.1.md` — sections: overview, state machine (§2.2), roles/permissions (§2.3), queue-item display contract, actions + events, decision schema, telemetry, escalation (§2.1); version `v0.1-2026-08`.

### 3.2 Reconcile backend to the spec (105 min)

- [ ] Audit `packages/review/src` against Spec 8; fix gaps (e.g., missing `review.item_released` on claim timeout, missing CHECK on `verdict`).
- [ ] Add `review.item_claimed`/`review.item_escalated`/`review.item_released` events to the Day-1 `event_types` catalog if absent.

### 3.3 Front-end scaffold (75 min)

- [ ] Add the review queue route + actions (claim/decide/release) to the React app, wired to the spec'd contract — read-only prototype today; no new backend behavior.

### 3.4 Boundary + wiring (45 min)

- [ ] Front-end → review backend only via the spec'd interface; `docs/architecture/wiring-map.md` gains the review-surface edge.

### 3.5 Tests (45 min)

- [ ] State-machine tests: `claim` on a `submitted` item is rejected; `decide` on an unclaimed item is rejected (no illegal transitions).
- [ ] `reject` without `reason` → validation error.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `docs/core/8_Human_Review_Interface_v0.1.md` | Standalone Spec 8 |
| `packages/review/src/state-machine.ts` (updated) | Legal transitions enforced |
| `packages/review/src/__tests__/state-machine.test.ts` | Illegal-transition tests |
| `web/src/.../review-queue.tsx` | Review surface prototype |

---

## 5. Acceptance Criteria

- [ ] `docs/core/8_Human_Review_Interface_v0.1.md` exists with the §2 state machine, roles, action/event list, decision schema, display contract (incl. pinned report), and telemetry contract.
- [ ] The state machine is enforced: a transition outside §2.2's graph throws (tested for `claim→decide` on wrong states).
- [ ] `verdict` is a closed enum with CHECK (`accept|reject|AUTO_APPROVED|escalate`); invalid verdict fails insert.
- [ ] `reject` without `reason` fails (validation test).
- [ ] `review.item_claimed`/`…escalated`/`…released` are in the event catalog; their emitters run on the matching transitions.
- [ ] The review queue route exercises claim/decide/release via the spec'd interface only.
- [ ] `pnpm --filter @harness/review test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **A spec that restates the backend is not a spec; it's documentation theater.** Spec 8 is load-bearing because it (a) fixes the state machine's *unstated* transitions (claim timeout) and (b) gives Day-28 a single source to version. If the draft only says "the review queue exists", it failed — the edge cases are the deliverable.
- **The `verdict` vocabulary is now closed and includes `AUTO_APPROVED`.** If Spec 8 omits it, Day-14's auto-approve path becomes an invisible state, and the sampling audit can't distinguish auto decisions from human ones at the interface level.
- **The pinned review report is part of the display contract.** A queue item must point at the hash-verified report (Day 23), so the human sees exactly the content the reviewer produced — not an editable note.
- **Missing evidence must be *shown* as missing.** A queue item that silently drops a null verification report lets a reviewer approve a change whose checks never ran. The display contract's job is to make gaps visible, not pretty.
- **Every action emits an event with `actor_id`.** If `claim` doesn't emit, dwell can't be measured per-actor; if `decide` doesn't carry `actor_id`, the identity work of Days 1–2 is unused and decisions are less auditable. The event is the audit trail.
- **Don't build the front-end now.** Day 24 specs the interface and scaffolds a read-only shell; the polished UI is Phase-3. Over-building the UI here burns the day's budget for zero measurement value.
- **Next (Day 25):** Week 5 checkpoint — sandbox + object store + review-report store + cache integrated, shadow metrics in the report.

---

*Prev: [Day 23 — Review-Report Storage + Large-Diff Handling via `ContentStore`](day-23.md) | Next: [Day 25 — Week 5 Checkpoint](day-25.md)*