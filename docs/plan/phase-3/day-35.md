# Day 35 — Week 7 Checkpoint: Closed Loop Demonstrable

| | |
|---|---|
| **Week** | 7 — Close the loop |
| **Spec refs** | Architecture §24.3 (Learning closed); Phase-3 README §5 (W7 milestone), §7 (Learning closes automatically) |
| **Estimated effort** | 5h |
| **Prerequisites** | Days 31–34 (calibration job, usefulness feedback, cycle wiring, optional durable queue) |

---

## 1. Objectives

By end of day you will have:

1. A demonstrable Week-7 milestone: **the closed loop runs end-to-end, automatically** — new review decisions + judge signals → calibration/routing update → measured (PROMOTE/HOLD) → observed → re-entered.
2. A demo that seeds a few decisions, lets the loop run a **full cycle** (Evaluate → Calibrate → Deploy → Observe → Evaluate again), and prints the correlation-id-linked outcome.
3. The human gate *visibly untouched*: the demo proves APPROVE/REJECT decisions remain human-only, with `AUTO_APPROVABLE` the only (still-sampled) auto-path untouched by the loop.
4. W7 evidence in `docs/retros/`; wiring map notes the learning-loop tokens + events.

The checkpoint proves the *Learning* step from Architecture §24.3 is a real, running, observable subsystem — not a diagram.

---

## 2. Design Decisions

### 2.1 Demo = one seeded cycle, full provenance

`scripts/demo-closed-loop.ts` seeds a window of decisions → runs the loop → asserts each stage emitted its event with a shared `learningCycleId` → prints calendar outcomes (candidate, A/B, PROMOTE/HOLD, observation). One clean cycle is the demonstrable unit, not four separate features.

### 2.2 The human-gate assertion is part of the demo

Print the decision records the loop consulted and prove it never mutated them — APPROVE/REJECT rows are inputs, `AUTO_APPROVABLE` path untouched. The loop's read-only relationship to human decisions is the phase's moral core.

### 2.3 Durable queue optional — show only what's configured

If `EVENT_TRANSPORT=redis`, show restart survival; if `inproc`, note durability is available-but-not-selected. Don't gate the checkpoint on a queue this deployment didn't choose.

---

## 3. Tasks

### 3.1 End-to-end cycle demo (90 min)

- [ ] `scripts/demo-closed-loop.ts` — seed → run cycle → print provenance → assert re-entry.

### 3.2 Human-gate untouchability check (45 min)

- [ ] Assert loop never writes APPROVE/REJECT decisions; `AUTO_APPROVABLE` sampling untouched.

### 3.3 Integration debt pass (60 min)

- [ ] Correlation id end-to-end; Observe feeds next Evaluate; HOLD path exercised (force a HOLD fixture).

### 3.4 Docs + evidence (45 min)

- [ ] `docs/architecture/wiring-map.md` — learning loop tokens/events.
- [ ] `docs/retros/phase3-w7.md`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo-closed-loop.ts` | Closed-loop cycle demo |
| `docs/architecture/wiring-map.md` (updated) | Learning-loop seam |
| `docs/retros/phase3-w7.md` | Week 7 checkpoint evidence |

---

## 5. Acceptance Criteria

- [ ] `pnpm demo:closed-loop` runs one full Evaluate → Calibrate → Deploy → Observe → Evaluate cycle.
- [ ] All stages joined by one `learningCycleId`.
- [ ] A HOLD fixture parks at Deploy and still re-enters Evaluate.
- [ ] The loop never mutates an APPROVE/REJECT decision (asserted).
- [ ] `pnpm test && pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Demonstrate the HOLD path, not just the happy PROMOTE.** A closed loop that only ever promotes is unproven — the guardrail is the feature.
- **Prove the human gate untouched.** If the demo can't show APPROVE/REJECT rows unchanged, the loop has leaked past calibration into decisioning — a red line.
- **Week 8 hardens + exits** — idempotency, redaction, concurrency, then E2E + exit review.
- **Next (Day 36):** hardening — write-back idempotency, token redaction, multi-provider concurrency.

---

*Next: [Day 36 — Hardening: Write-back Idempotency, Token Redaction, Multi-provider Concurrency](day-36.md)*