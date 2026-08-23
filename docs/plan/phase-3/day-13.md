# Day 13 — FAILED → Flag in Report (Not Blocking); Evidence Stored

| | |
|---|---|
| **Week** | 3 — Verification breadth |
| **Spec refs** | Spec 7 (evidence invariants, report shape); Architecture §5 (evidence before confidence); Phase-3 README §7 (FAILED flags report) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 12 (sandbox build/test run producing a `VerificationReport`) |

---

## 1. Objectives

By end of day you will have:

1. A policy that a **FAILED** verification *flags the review report* (a visible "tests FAILED — see evidence" marker) but **never blocks** the human decision gate — rejection remains the human's call.
2. Raw evidence (command stdout/stderr, exit code, per-check status) **stored and linked** to the report + review, not merely a boolean verdict.
3. The report rendering surfaces the failure **with the evidence**, so a reviewer can judge a flaky vs a genuine break.
4. Tests proving FAILED does not short-circuit the review pipeline; it annotates and continues to the human.

This is the "FAILED is information, not a gate" day — the harness flags, the human decides.

---

## 2. Design Decisions

### 2.1 FAILED is a signal to Attention, not a blocker to Decision

The verification outcome feeds the report + attention score; the review queue stays reachable and the human can still APPROVE/REJECT. The harness must never auto-reject on a red verification — that would remove the human from the very gate the architecture protects.

### 2.2 Evidence link, not inline blob

Store build/test output via `@harness/object-store` (content-addressed) or `verification` rows keyed by `VerificationResultID`; the report holds a **reference** (hash/URI), not the megabyte of logs. `VerificationReport.failedChecks[]` lists `{ kind, exitCode, evidenceRef, tail }` where `tail` is a truncated preview.

### 2.3 Verdicts vs evidence

- `overall` may be FAILED while individual checks are PASSED/FAILED/TIMED_OUT/SKIPPED.
- A TIMED_OUT is distinct (infra) from FAILED (code) — surface both honestly; the human reads them differently.

### 2.4 One report, one evidence snapshot

The report + evidence are written **atomically** before `verification.completed` is emitted, so no consumer sees a "done" event with half-written evidence.

---

## 3. Tasks

### 3.1 Evidence persistence (60 min)

- [ ] Write raw output to object store (or `verification_evidence` rows); return `evidenceRef`.

### 3.2 Report flagging (60 min)

- [ ] Mark report `verdict` + `failedChecks` with evidence refs + truncated tails.

### 3.3 Non-blocking wiring (75 min)

- [ ] Review pipeline: FAILED report → review queue item proceeds; report + attention note carry the flag.
- [ ] Guarantee no auto-reject in the orchestrator path (test).

### 3.4 Report rendering (60 min)

- [ ] `apps/web`/report renderer shows the FAILED flag + evidence preview + "human decision required".

### 3.5 Tests (60 min)

- [ ] FAILED → report flagged, pipeline proceeds to AWAITING_REVIEW (not REJECTED).
- [ ] Evidence stored + linked; atomic write before event.
- [ ] TIMED_OUT distinguished from FAILED.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/verification-engine/src/evidence-store.ts` | Evidence persistence + ref |
| `packages/verification-engine/src/report-flag.ts` | FAILED flag + failed-checks assembly |
| `packages/review/src/report-render.ts` (or apps/web) | Failure + evidence rendering |
| `packages/verification-engine/src/__tests__/failure-flag.test.ts` | Tests |

---

## 5. Acceptance Criteria

- [ ] FAILED verification adds a visible flag to the report with evidence refs + preview.
- [ ] A FAILED report does **not** auto-reject; the item reaches the human gate.
- [ ] TIMED_OUT is labeled distinct from FAILED (infra vs code).
- [ ] Evidence written before `verification.completed` (atomic).
- [ ] `pnpm --filter @harness/verification-engine test` green.

---

## 6. Notes & Pitfalls

- **The non-negotiable invariant:** no red verification may remove the human decision. A test that asserts "FAILED ⇒ still AWAITING_REVIEW" is load-bearing — keep it in the suite forever.
- **Truncate, don't omit.** Store the full output to object store, preview the tail in the report — a reviewer needs enough to judge without a 2MB render.
- **TIMED_OUT is infra, FAILED is code.** Collapsing them misleads the human (a slow CI isn't a broken PR). Keep them separate.
- **Day 14** makes verification cheaper + faster via the dependency graph (targeted/incremental).

---

*Next: [Day 14 — Targeted/Incremental Verification via Dependency Graph](day-14.md)*