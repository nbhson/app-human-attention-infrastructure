# Day 23 — Review UI: Queue & Diff View

| | |
|---|---|
| **Week** | 4 — Human Loop & E2E |
| **Spec refs** | Spec 6 §5 (Human Review Interface requirements), Spec 7 §6 (evidence display) |
| **Estimated effort** | 7 h |
| **Prerequisites** | Day 22 (queue API), Day 17 (diffs + evidence), Day 18 (labels/factors) |

---

## 1. Objectives

1. Build the **review queue page** in `apps/web` (React + Vite): prioritized list with label badges, factors, and one-click claim.
2. Build the **review detail page**: side-by-side diff view, verification report panel, evidence links, approve/reject form.
3. Surface the **"why am I seeing this"** explanation (rule_id, policy_version, factor breakdown) on every item — explainability is a spec requirement, not a nicety.
4. Keep the UI **read-thin**: all logic stays in the Day-22 API; the UI renders payloads.

> **Why this matters:** the review screen is where the harness's value proposition is won or lost. A reviewer who can see priority + evidence + diff in one glance reviews in seconds; one who has to hunt through logs will route around the system within a week.

---

## 2. Design Decisions

### 2.1 Pages & routes

| Route | Component | Data |
|---|---|---|
| `/review` | `QueuePage` | `GET /api/review/queue?status=QUEUED` (poll 5 s) |
| `/review/:id` | `ReviewDetailPage` | `GET /api/review/queue/:id` |

### 2.2 Queue page

```
┌────────────────────────────────────────────────────────────┐
│ Review Queue (12)                    Budget today: 14/20   │
├────┬──────────┬───────┬──────────────────────────┬────────┤
│ #  │ Label    │ Score │ Task                     │ Action │
│ 1  │ CRITICAL │ 0.91  │ Fix payment retry loop   │ Claim  │
│ 2  │ HIGH     │ 0.74  │ Add logging to API       │ Claim  │
│ 3  │ HIGH*    │ 0.68  │ Flaky: cart totals test  │ Claim  │
└────┴──────────┴───────┴──────────────────────────┴────────┘
```

- Label badge colors: CRITICAL red / HIGH orange / MEDIUM yellow / LOW gray. `*` = flaky flag.
- Budget indicator from Day-19 fatigue config — reviewers see the budget discipline working.
- ESCALATE items pinned to top with a distinct banner.

### 2.3 Detail page layout

```
┌─────────────────────────────┬──────────────────────────────┐
│ WHY THIS ITEM               │ VERIFICATION                 │
│ Label: HIGH (0.74)          │ ✓ COMPILE PASSED  [evidence] │
│ Rule: r2-high (policy v1)   │ ✓ TEST PASSED (flaky) [evid.]│
│ Factors: risk .6 impact .8  │                              │
│          novelty .3 …       │ DIFFS (3 files, +182/−41)    │
│                             │ [side-by-side diff viewer]   │
├─────────────────────────────┴──────────────────────────────┤
│ ○ Approve   ○ Reject    Rationale: [____________]          │
│ Was this item worth your attention? (yes/no)  [Submit]     │
└────────────────────────────────────────────────────────────┘
```

- Diff viewer: render Day-17 `structuredPatch` hunks; no syntax highlighting dependency in Phase 1 (keep bundle small) — monospace + added/removed line coloring is enough.
- Evidence links open raw evidence bodies (check output, test JSON) in a modal — **Claim ≠ Evidence** made literal: every PASSED badge is one click from its proof.
- The `wasUseful` toggle is **required** before Submit (feeds Day-19 adaptive thresholds).

### 2.4 State & polling

- TanStack Query for fetching + 5 s polling on the queue; mutations (claim/decide/drop) invalidate the queue query.
- Optimistic UI on claim; on 409 (someone else claimed) show a toast and refetch — matches Day-22 semantics.
- No auth in Phase 1 beyond a `X-Reviewer-Id` header from an env-configured name (SSO is Phase 2; recorded in backlog).

---

## 3. Tasks

- [ ] **3.1** Scaffold `apps/web` pages/routes + API client module. (1 h)
- [ ] **3.2** QueuePage: table, badges, budget indicator, ESCALATE banner, polling. (1.5 h)
- [ ] **3.3** ReviewDetailPage: "why" panel + verification panel + evidence modal. (1.5 h)
- [ ] **3.4** Diff viewer component (hunk rendering from structuredPatch). (1.5 h)
- [ ] **3.5** Decision form (approve/reject + rationale + wasUseful) with 409 handling. (1 h)
- [ ] **3.6** Component tests (Testing Library): queue renders sorted; decision submits payload; evidence modal opens. (30 min)

---

## 4. Deliverables

| File | Description |
|---|---|
| `apps/web/src/pages/{QueuePage,ReviewDetailPage}.tsx` | Review UI |
| `apps/web/src/components/{DiffViewer,EvidenceModal,FactorBreakdown}.tsx` | Components |
| `apps/web/src/api/review.ts` | API client |

---

## 5. Acceptance Criteria

- [ ] Queue shows label, score, flaky marker, and budget consumption; sorted by position.
- [ ] Detail page shows rule_id + policy_version + all five factors (or "unavailable" markers).
- [ ] Every PASSED/FLAKY badge links to its evidence body.
- [ ] Submit is disabled until decision + rationale + wasUseful are provided; 409 on claim shows a toast and refreshes.
- [ ] `pnpm test && pnpm lint` green (incl. web workspace).

---

## 6. Notes & Pitfalls

- **Don't build a dashboard yet** — metrics/observability UI is Day 27; the review loop is the only UI that must exist for the E2E demo.
- **The "why" panel is mandatory** — a priority score without its factors and rule id is a number reviewers learn to distrust.
- **Keep diffs read-only** — inline editing in the review UI is a Phase-2+ temptation that breaks the "agent proposes, human disposes" boundary.
- **Next:** [Day 24 — Decision Flow: Merge on Approve, Rework on Reject](day-24.md) wires what happens *after* the reviewer clicks Submit.

---

*Prev: [Day 22 — Review Backend: Queue API & Decisions](day-22.md) | Next: [Day 24 — Decision Flow: Merge on Approve, Rework on Reject](day-24.md)*
