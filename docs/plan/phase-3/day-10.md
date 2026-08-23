# Day 10 — Week 2 Checkpoint: Approve → Comment Lands (ON); OFF → No-op

| | |
|---|---|
| **Week** | 2 — Write-back |
| **Spec refs** | Phase-3 README §5 (W2 milestone), §7 (write-back exit criterion) |
| **Estimated effort** | 5h |
| **Prerequisites** | Days 06–09 (seam, 4 adapters, audit + idempotency, toggle) |

---

## 1. Objectives

By end of day you will have:

1. A demonstrable Week-2 milestone: **approve a review with write-back ON → a PR comment + status lands on the external host; OFF → provably nothing external.**
2. An end-to-end demo that replays one real (stubbed-HTTP) decision through the full write-back path across all four providers + Jira.
3. Integration debt from Days 06–09 closed: idempotent retry verified end-to-end, redaction verified on real adapter error paths, toggle false-safety confirmed.
4. Week-2 evidence captured in `docs/retros/`.

The checkpoint makes write-back *observable and provable*, not just unit-tested.

---

## 2. Design Decisions

### 2.1 Demo = one decision, two runs, asserted outcomes

`scripts/demo-writeback.ts` takes a provider + decision, runs ON then OFF, and asserts by querying `writeback_log` (ON: SUCCEEDED rows; OFF: only SKIPPED/zero rows). Reuse the Day 09 demo and extend it to also assert idempotency (re-running the ON case yields DUPLICATE).

### 2.2 Correctness is "one external write per decision", not "writes happened"

The checkpoint's hard criterion is that a retried/duplicated decision never produces a second comment — idempotency is the safety property, the visible comment is the demo.

### 2.3 Write-back is now a first-class subsystem in the wiring map

Record the `WriteBackService` token, its `@harness/writeback` package, and the `writeback_log` table in `docs/architecture/wiring-map.md` so the seam is documented at the same altitude as the other Phase-2 seams.

---

## 3. Tasks

### 3.1 End-to-end demo (90 min)

- [ ] `scripts/demo-writeback.ts` — full path for GitHub + one GitLab/Bitbucket + Jira, ON then OFF, with log assertions.
- [ ] Idempotency assertion: rerun ON → DUPLICATE, still one external write.

### 3.2 Integration debt pass (60 min)

- [ ] Verify redaction on a forced adapter 401 (error path) — no token bytes in log.
- [ ] Verify toggle false-safety end-to-end (env OFF defeats ON flag).

### 3.3 Wiring map + docs (45 min)

- [ ] Add `@harness/writeback` + `writeback_log` + `TOKENS.WriteBackService` to `docs/architecture/wiring-map.md`.

### 3.4 Retro evidence (30 min)

- [ ] Capture W2 demo output + the "OFF = nothing external" proof in `docs/retros/phase3-w2.md`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo-writeback.ts` | Full write-back demo with assertions |
| `docs/architecture/wiring-map.md` (updated) | Write-back seam + token + table |
| `docs/retros/phase3-w2.md` | Week 2 checkpoint evidence |

---

## 5. Acceptance Criteria

- [ ] `pnpm demo:writeback` runs the ON decision → comment/status lands (stubbed), OFF → zero external writes, rerun → DUPLICATE.
- [ ] `writeback_log` records SUCCEEDED rows for ON, zero non-SKIPPED rows for OFF.
- [ ] Retried decision produces exactly one external comment.
- [ ] Forced 401 logs a redacted error (no token bytes).
- [ ] `pnpm test && pnpm lint` green; wiring map updated.

---

## 6. Notes & Pitfalls

- **Provable OFF is the deliverable that matters most.** A reviewer deciding "no automatic comment this time" must be able to trust it was truly silent — the log query *is* that trust.
- **Do not demo against a fake provider that can't fail.** Exercise the 401 path so the redaction guarantee is real, not a fixture assertion on a happy shape.
- **Checkpoint stops write-back work here.** Week 3 pivots to verification breadth (clone → sandbox tests) — do not start it early.
- **Next (Day 11):** clone a PR into a sandbox worktree (`GitProvider.cloneAndCheckout`).

---

*Next: [Day 11 — Clone PR into Sandbox Worktree (`GitProvider.cloneAndCheckout`)](day-11.md)*