# @harness/review — Human Review Interface

The review-queue state machine and service behind the reviewer UI — where humans
claim, decide, release, escalate, or drop changes awaiting review.

**Status:** complete (as-built) ·
**Boundary rule:** engine (R6) — imports only shared packages + itself; cross-engine dependencies are injected as narrow structural seams.

---

## Purpose

1. **Expose the queue** — list/detail read models over `review_queue` rows.
2. **Enforce the lifecycle** — the `ReviewAction`/`ALLOWED_FROM` legal-transition graph.
3. **Capture decisions** — `APPROVE` / `REJECT` with a required rationale.
4. **Handle the off-ramps** — `release` (claim timeout), `escalate` (higher authority), `drop`.
5. **Feed the attention loop** — report reviewer usefulness back to calibration.

---

## Review-queue lifecycle

```text
                  QUEUED
                    │ claim (atomic guarded UPDATE)
                    ▼
                 CLAIMED ───────────────┐
                    │                   │
        ┌───────────┼──────────┐        │
        ▼           ▼          ▼        ▼
     decide      release    escalate   drop
        │           │          │        │
        ▼           ▼          ▼        ▼
     DECIDED      QUEUED     ESCALATED DROPPED
     (APPROVE/   (claim      (higher-   (terminal)
      REJECT)     returned)   authority)
```

| Action | Legal from | Effect |
| --- | --- | --- |
| `claim` | `QUEUED` | `QUEUED → CLAIMED` (atomic guarded UPDATE; losing racer → `QueueConflictError`) |
| `decide` | `CLAIMED` | `CLAIMED → DECIDED`, records `APPROVE`/`REJECT` decision |
| `release` | `CLAIMED` | `CLAIMED → QUEUED` (timed-out claim never orphans) |
| `escalate` | `CLAIMED` | `CLAIMED → ESCALATED`, records `ESCALATED` decision |
| `drop` | `QUEUED`, `CLAIMED` | → `DROPPED`, requires rationale |

`claim` is deliberately **not** a read-then-assert — it is an acquire enforced by
an atomic guarded UPDATE; the other actions read the row and assert against the
state-machine table. A bad move throws `IllegalTransitionError`, never logs-and-continues.

---

## Decisions

The API accepts `APPROVE` / `REJECT` (`DecisionChoice`). A submitted
decision carries `rationale` (required) + `wasUseful` (feeds the
alert-fatigue loop). `HumanDecisionType` also has `REQUEST_CHANGES`,
`OVERRIDDEN`, `DEFERRED`, `ESCALATED`, and the machine `AUTO_APPROVED` (recorded
by the attention engine, never passed through the review UI).

---

## Structural seams (injected, not imported)

Because review is an engine under R6, its three cross-engine needs are declared
as narrow interfaces and injected by the composition root:

| Seam | Provides |
| --- | --- |
| `TaskTransition` | Drive the task state machine (`transitionTask`) — e.g. `REJECT → REWORK`. |
| `FeedbackReporter` | Report `wasUseful` + comment back to attention calibration. |
| `DiffProvider` | unified diffs (`diffChange → ReviewFileDiff[]`). |

---

## Modules

| Module | What it provides |
| --- | --- |
| `types.ts` | `DecisionInput`, `DropInput`, `ReleaseInput`, `EscalateInput`, `QueueItem`/`QueueListItem`/`QueueItemDetail`, the three seams, and error classes. |
| `state-machine.ts` | `ReviewAction`, `ALLOWED_FROM`, `canTransition`, `assertTransition`, `IllegalTransitionError`. |
| `service.ts` | `ReviewService` — `list` / `detail` / `claim` / `decide` / `release` / `escalate` / `drop`. |

Error taxonomy (mapped to HTTP status by the routes): `ReviewError` (base),
`QueueConflictError` (409), `QueueStateError`, `QueueItemNotFoundError` (404),
`MissingRationaleError`, `EvidenceNotFoundError`.

---

## Interaction with other packages

```text
   attention-engine ──(attention.item_routed)──▶ review (queue creation)
   review ──(review.decision_submitted)────────▶ orchestrator (close/rewind task)
   review ──(review.item_claimed/released/escalated)──▶ observability (dwell timers)
```

All inter-package traffic is by event or injected seam — review never imports an
engine directly; `apps/web` talks to it through `apps/api` routes.

---

## Key invariants

- **Claim is an acquire.** Two reviewers racing for the same item: one gets it,
  the other gets a `QueueConflictError`.
- **No silent drops.** `drop` and `escalate` require a rationale.
- **Decisions are evidence.** Every decision records actor, rationale, and
  usefulness, feeding both the audit trail and calibration.

---

## Directory structure

```
src/
├── index.ts
├── types.ts         # inputs, read models, seams, errors
├── state-machine.ts # ReviewAction, ALLOWED_FROM, assertTransition
└── service.ts       # ReviewService
```

## Public API surface

```typescript
// types: DecisionChoice, DecisionInput, DropInput, ReleaseInput, EscalateInput,
//        QueueItem, QueueListItem, QueueItemDetail, FactorScore,
//        VerificationCheckView, ReviewFileDiff, TaskTransition,
//        FeedbackReporter, DiffProvider, + error classes
// state-machine: ReviewAction, canTransition, assertTransition, IllegalTransitionError
// service: ReviewService
```

## Wiring

The service is registered in `apps/api/src/bootstrap.ts`; routes live in
`apps/api/src/routes/review.ts`; the UI is `apps/web`.