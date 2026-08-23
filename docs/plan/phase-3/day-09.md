# Day 09 — Write-back Toggle at Review-Decision Time; OFF = Nothing External

| | |
|---|---|
| **Week** | 2 — Write-back |
| **Spec refs** | Phase-3 README §3 (toggle anchor), §7 ("behind a toggle; OFF = nothing external"); review package decisions |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 08 (idempotent `writeback_log`); Day 06 decision-path stub |

---

## 1. Objectives

By end of day you will have:

1. A per-review **write-back toggle** set at decision time (or per-provider config), promoted from the Day 06 env stub to a real field the human controls.
2. The decision handler turns an **APPROVE** into an optional `COMMENT` ("Approved by …") + `STATUS` write *only when the toggle is ON*; **OFF → nothing external, provably** (empty `writeback_log`).
3. The toggle persisted on the review/decision so an audit can reconstruct *why* nothing was written on a given decision.
4. A demo contrasting ON vs OFF.

This is the day write-back becomes an explicit, reversible human choice — the reviewer still never authors code.

---

## 2. Design Decisions

### 2.1 The toggle is a decision-time boolean, not just env

Keep the env as the *default ceiling* (`WRITEBACK_ENABLED=false` at rest), but carry an explicit `writeback: boolean` on the decision request. Effective write-back = `env ON && request ON`. A missed toggle fails safe (OFF).

### 2.2 What a decision writes

- APPROVE + ON → a `COMMENT` (short summary: who approved, review link) and a `STATUS=succeeded`.
- REJECT + ON → a `COMMENT` (rejection rationale) and a `STATUS=failure`.
- Any OFF → no write-back; the decision is recorded in `event_log`/`writeback_log` (as SKIPPED) alone.

The body is *commentary*, generated from the review record — never a diff or proposal.

### 2.3 OFF is provable

Because Day 08 short-circuits with no log on OFF, "OFF = nothing external" is a query: `SELECT count(*) FROM writeback_log WHERE decision_id = $1 AND outcome <> 'SKIPPED'` → 0. The demo asserts this.

---

## 3. Tasks

### 3.1 Toggle plumbing (60 min)

- [ ] Add `writeback` flag to the decision request + persist it on the decision row (field or metadata).
- [ ] `writebackEnabled(decision) = env && flag` helper in `apps/api`.

### 3.2 Decision-handler write-back (90 min)

- [ ] APPROVE/REJECT → build COMMENT/STATUS intents (`decision_id` attached) → `WriteBackService.write` gated by the toggle.
- [ ] Link `writeback_log` rows back to `decision_id` (add column or metadata).

### 3.3 False-safety audit query (45 min)

- [ ] Add a debug/ops query: "external writes for decision X" → 0 when OFF.

### 3.4 Demo script (45 min)

- [ ] `scripts/demo-writeback-toggle.ts` — run one decision ON, one OFF, print both outcomes + log rows.

### 3.5 Tests (60 min)

- [ ] ON + APPROVE → COMMENT+STATUS intents emitted; OFF → zero intents, no log rows.
- [ ] `WRITEBACK_ENABLED=false` ceiling blocks even a request-level ON.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/routes/reviews.ts` (updated) | Decision-time write-back behind toggle |
| `apps/api/src/writeback-gate.ts` | `writebackEnabled(decision)` helper |
| `packages/db/src/schema/writeback-log.ts` (updated) | `decision_id` linkage |
| `scripts/demo-writeback-toggle.ts` | ON vs OFF demo |

---

## 5. Acceptance Criteria

- [ ] APPROVE with toggle ON produces a PR/MR comment + success status and `writeback_log` SUCCEEDED rows.
- [ ] Any decision with toggle OFF produces zero external writes and zero non-SKIPPED `writeback_log` rows.
- [ ] `WRITEBACK_ENABLED=false` at rest defeats a request-level ON.
- [ ] Decision stores the toggle state for later audit.
- [ ] `pnpm test && pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Fail-safe default.** If any resolution (env, flag, config) is ambiguous, the answer is OFF. Write-back is the one path that touches an external system — defaulting conservative is the point.
- **Don't write on non-terminal states.** Only APPROVE/REJECT trigger the comment/status; a `release`/`escalate` produces no external write.
- **The human still drives.** The toggle is set by the reviewer at decision time; the harness never flips it on by itself.
- **Day 10** is the Week 2 checkpoint: approve → comment lands (ON); OFF → demonstrable no-op.

---

*Next: [Day 10 — Week 2 Checkpoint: Approve → Comment Lands (ON); OFF → No-op](day-10.md)*