# Human Review Interface
## Specification v0.1 – The Versioned Contract for Human Attention

**Status:** Draft v0.1  
**Dependencies:** Architecture (`HAI_Harness_Architecture_v0.2.md`), Attention Engine (`6_Attention_Engine_v0.2.md`), Verification Engine (`7_Verification_Engine_v0.2.md`)  
**Purpose:** Consolidate the review surface — the queue, its finite state machine, the actions a human can take, the data each item must display, the decision record it produces, and the telemetry each action emits — into a single versioned contract, so the interface is an auditable engineering artifact rather than folklore living implicitly across `@harness/review` and the Attention Engine's escalation path.

---

# 1. Purpose

The Human Review Interface is the **only surface through which a human acts on an AI-generated change**. It answers three questions that were previously unstated:

1. **What states may a review item occupy**, and which transitions between them are legal?
2. **What may a human do** at each state, under which role, and what is the observable effect (event + decision record)?
3. **What must be shown** to a human so their decision is well-informed and auditable?

It is deliberately a *contract*, not a mockup. The backend (`packages/review`) already exists; this spec makes its rules explicit so that Day 28 can version them and Phase 3 can build the polished UI against them.

> **The line that matters:** Spec 8 says *how a human acts*; Spec 6 says *what deserves a human*. Heuristics (attention score, review-worthiness) live in Spec 6. The mechanism (states, actions, decision records, telemetry) lives here.

---

# 2. Review State Machine (normative)

## 2.1 States

| State | Persisted `ReviewQueueStatus` | Meaning |
|-------|-------------------------------|---------|
| `queued` | `QUEUED` | Awaiting a claim; visible in the queue. |
| `in_review` | `CLAIMED` | A reviewer holds the item; dwell is running. |
| `submitted` | `DECIDED` | A verdict has been recorded; awaiting apply/dismiss. |
| `dismissed` | `DROPPED` | The change was dropped; terminal. |
| `escalated` | `ESCALATED` | Handed to a higher authority; terminal for the holder. |

> **Vocabulary note:** Spec 8 uses the interface vocabulary (`queued`/`in_review`/`submitted`/`dismissed`/`escalated`). The persistence layer uses the closed `ReviewQueueStatus` enum (`QUEUED`/`CLAIMED`/`DECIDED`/`DROPPED`/`ESCALATED`). These are the same graph; the interface names exist so the contract reads naturally to a reviewer. Verdicts (see §5) use the separate `HumanDecisionType` vocabulary.

## 2.2 Legal transitions (finite graph)

```text
queued ──claim───────▶ in_review ──decide──────▶ submitted
   ▲                      │    │
   │                      │    └──escalate────▶ escalated
   │                      │
   │ release (voluntary)  └──decide(reject/approve)──▶ submitted
   │ expire (timeout)                     │
   └──────────queued───────────release◀───┘
```

| Action | From | To | Emits |
|--------|------|----|-------|
| `claim` | `queued` | `in_review` | `review.item_claimed` |
| `decide` (approve · reject) | `in_review` | `submitted` | `review.decision_submitted` |
| `release` (voluntary) | `in_review` | `queued` | `review.item_released` |
| `expire` (claim timeout) | `in_review` | `queued` | `review.item_released` |
| `escalate` | `in_review` | `escalated` | `review.item_escalated` |
| `drop` | `queued` · `in_review` | `dismissed` | `review.decision_submitted` |

**Every transition outside this graph is illegal.** There is no `submitted → in_review`, no `escalated → queued`, and no re-decision of a `submitted` item. `claim` is a guarded atomic transition: the QUEUED→CLAIMED edge is enforced by an atomic guarded UPDATE (`… WHERE status = 'QUEUED'`) that raises `QueueConflictError` when two reviewers race — it is never performed as an unsafe read-then-write. All other transitions are enforced declaratively by `assertTransition` (see §6.3).

## 2.3 Claim timeout (`expire`)

An item held in `in_review` whose claim timer expires **re-queues itself** (emits `review.item_released`) so no item is silently orphaned in `in_review`. The timeout duration is a Phase-3 tunable; the *transition* is normative now — a claim is a lease, not ownership.

---

# 3. Roles & Permissions

Roles are additive (`ADMIN ⊇ REVIEWER ⊇ OPERATOR`), from the Day-1/2 unified identity work:

| Role | Capabilities |
|------|--------------|
| `OPERATOR` | View queue detail; observe states. |
| `REVIEWER` | `claim`, `decide`, `release`, `escalate`, `drop`, `approve_tool`. |
| `ADMIN` | Everything `REVIEWER` can do, plus policy management (Spec 6). |

Every mutating action is wrapped in `requireRole(…, Role.Reviewer, Role.Admin)` (or a subset). The acting identity (`actor_id`, `actor_email`) comes from the authenticated principal (`request.auth.user`), **never** from a header or request body.

## 3.1 `approve_tool` (tier-2)

Day 23 introduced OPERATOR-tier approvals for sandboxed tool calls. The interface exposes `approve_tool(tier2)` — approve/deny a tier-2 tool call requested by an agent in code mode — as a first-class `REVIEWER` action (Spec 3 §14.1). It does not mutate the queue; it resolves a pending approval and emits `approval.decided` (Day 23's event), leaving the review queue to this spec's state machine.

---

# 4. Queue-Item Display Contract

A queue item must render the following. **Missing data must be shown as missing**, never silently omitted — a reviewer who cannot see that a verification report is absent could approve a change whose checks never ran.

## 4.1 Required display fields

| Field | Source | Requirement |
|-------|--------|-------------|
| Change diff | Spec 5 (Artifact/Change Tracker) | Structured patch (per-file hunks, added/removed, new-file flag). |
| Attention assessment | Spec 6 | `combinedPriority`, `label`, factor breakdown; empty factors shown as "no factors". |
| Verification evidence | Spec 7 | Each check's `kind` + `status`; a `null` evidence id is rendered as "no evidence", with a link when present. |
| Calibration confidence | Spec 4 | The model's calibration confidence for the decision being reviewed; `null` → "not calibrated". |
| Rule provenance | Spec 6 | `ruleId` + `policyVersion` that produced the label. |

## 4.2 The decision form

The `decide` form requires three inputs before it will submit:

1. **verdict** — `approve` or `reject` (escalation is a separate action, §4.3).
2. **rationale** — required for both, but **mandatory for `reject`**; the server rejects an empty `reject` rationale (400 `MissingRationaleError`). A rejection without a reason is un-actionable.
3. **wasUseful** — a calibration signal feeding the Day-12/meta-review loop.

An optional free-text `comment` rides along and is persisted on the decision.

---

# 5. Decision Schema

```text
review_decisions
├── id: text PK
├── review_item_id: text NOT NULL
├── actor_id: text NOT NULL        # unified identity (Day 1/2)
├── verdict: text NOT NULL         # closed enum, see below
├── reason: text NOT NULL          # required for reject, optional for accept
├── decided_at: timestamptz NOT NULL
└── sampled_for_audit: boolean     # Day 14 sampling flag
```

The `verdict` is a **closed enum** with a `CHECK`:

```text
APPROVED | REJECTED | ESCALATED | AUTO_APPROVED
```

- `APPROVED`/`REJECTED` — human `decide`.
- `ESCALATED` — human `escalate` (still recorded as a decision so the audit trail is unbroken).
- `AUTO_APPROVED` — Day 14's automatic approval; recorded distinctly so the sampling audit can tell a human decision from an automatic one.

An invalid verdict fails the insert (`humanDecisionTypeCheck`), so the enum cannot drift.

---

# 6. Actions & Events

## 6.1 Action table

| Action | Role | Allowed from | Effect | Event |
|--------|------|--------------|--------|-------|
| `claim` | REVIEWER | `queued` | Atomic guarded claim; starts dwell. | `review.item_claimed` |
| `decide(approve)` | REVIEWER | `in_review` | `DECIDED`, decision APPROVED. | `review.decision_submitted` |
| `decide(reject)` | REVIEWER | `in_review` | `DECIDED`, decision REJECTED; empty rationale → 400. | `review.decision_submitted` |
| `release` | REVIEWER | `in_review` | Back to `queued`, claim cleared. | `review.item_released` |
| `escalate` | REVIEWER | `in_review` | `ESCALATED`, decision ESCALATED; rationale required. | `review.item_escalated` |
| `drop` | REVIEWER | `queued` · `in_review` | `DROPPED`. | `review.decision_submitted` |
| `approve_tool` | REVIEWER | (pending tier-2) | Resolves approval. | `approval.decided` |

## 6.2 Event catalog (Day-24 additions)

These are registered in the Day-1 `event_types` catalog:

| Event | Payload (key fields) |
|-------|----------------------|
| `review.item_claimed` | `queue_id`, `task_id`, `reviewer_id` |
| `review.item_released` | `queue_id`, `task_id`, `actor_id` |
| `review.item_escalated` | `queue_id`, `decision_id`, `task_id`, `actor_id` |
| `review.decision_submitted` | (pre-existing, Day 4) |
| `approval.decided` | (pre-existing, Day 23) |

Every action emits an event carrying `actor_id`. If `claim` did not emit, dwell could not be measured per-actor; if `decide` did not carry `actor_id`, the identity work of Days 1–2 would be unused and decisions less auditable. **The event is the audit trail.**

## 6.3 Enforcement

- `packages/review/src/state-machine.ts` — the declarative `ALLOWED_FROM` map + `assertTransition(from, action)`, which throws `IllegalTransitionError` (mapped to `409` by the route layer).
- `claim` (QUEUED→CLAIMED) is enforced by the service's atomic guarded UPDATE rather than read-then-assert, to preserve race-safety.

---

# 7. Telemetry Contract

| Action | Telemetry |
|--------|-----------|
| `claim` | Starts a dwell timer (Day 4's `review_dwell`); stopwatch from claim to decide/release/escalate. |
| `decide` | Emits `review.decision_submitted` with `actor_id` + `sample` flag; records dwell. |
| `release`/`escalate`/`drop` | Emit their event with `actor_id`; close the dwell timer. |

---

# 8. API Surface

The web app reaches the review backend **only** through the spec'd HTTP interface (`apps/api/src/routes/review.ts`), never through a second channel:

```text
GET    /api/review/queue            # list (optionally ?status=)
GET    /api/review/queue/:id        # composed detail payload (§4)
GET    /api/review/evidence/:id     # a verification evidence body
POST   /api/review/queue/:id/claim
POST   /api/review/queue/:id/decide       { decision, rationale, wasUseful, comment? }
POST   /api/review/queue/:id/release
POST   /api/review/queue/:id/escalate     { rationale }
POST   /api/review/queue/:id/drop         { rationale }
```

Error mapping: not-found → 404; wrong-state / illegal-transition / race → 409; missing rationale → 400.

---

# 9. Success Criteria

- The state machine graph (§2.2) is enforced; an illegal transition throws (`claim→decide` on wrong states is tested).
- `verdict` is a closed enum with `CHECK`; an invalid verdict fails insert.
- `reject` without a non-empty `reason` fails validation.
- `review.item_claimed`/`…escalated`/`…released` are in the event catalog and emitted on the matching transitions.
- The queue route exercises `claim`/`decide`/`release`/`escalate`/`drop` via this interface only.

---

## Changelog

### v0.1 (Day 24)
- Initial standalone spec: extracted the review surface's state machine, roles,
  action/event list, decision schema, display contract, and telemetry into one
  versioned contract. Added the explicit `claim`-timeout (`expire → queued`)
  transition and the closed `verdict` enum (now including `AUTO_APPROVED`).