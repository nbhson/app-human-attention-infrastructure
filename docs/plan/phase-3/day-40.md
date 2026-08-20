# Day 40 — Phase-3 Exit Review: Learning Closed + Demonstrable; Tag Release

| | |
|---|---|
| **Week** | 8 — Harden, document, exit |
| **Spec refs** | All 11 specs (v1.0 candidates), Architecture §24.3 (Phase 3 exit criteria) |
| **Estimated effort** | 5h |
| **Prerequisites** | Day 39 (benchmark regression + judge-agreement report) |

---

## 1. Objectives

This is the **Phase-3 exit review** — the last checkpoint of the phase and of the three-phase plan. No new features. By end of day you will have:

1. A **verification that the learning loop is closed and demonstrable** — the phase's single defining exit criterion, evidenced, not asserted.
2. A **confirm-list run through the phase invariants** (modular monolith, transport swap, human gate, `AUTO_APPROVABLE`-only auto-path, hybrid-earns-default), each backed by its test/report.
3. A **release tag** (`v0.3.0` or equivalent) cut on the verified commit, with the exit-review decision recorded.
4. A **Phase-3 final summary** in `docs/summary/` and a phase-level retro.

**Failure of any exit criterion blocks the tag.**

---

## 2. Exit Criteria (the non-negotiable gate)

| Criterion | Evidence |
|-----------|----------|
| Learning loop closed: Evaluate→Calibrate→Deploy→Observe runs continuously | Day 33 loop + Day 35 demo + Day 37 E2E |
| Loop is autonomous-but-gated: no notable change self-applies | Day 33/35 safety proofs + tests |
| Human gate intact: AI never replaces APPROVE/REJECT | `triggered_by === 'human'` tests (weeks 2/5/7) |
| `AUTO_APPROVABLE` remains the only auto-path (sampling-audited) | sampling-audit tests, all weeks |
| Hybrid ranking is default only by winning the A/B | Day 19/32 `rank.cutover_applied` + gates |
| Durable queue is a transport swap behind `IEventBus` (contract unchanged) | Day 34 contract-unchanged tests |
| Multi-agent bounded + roles enforced | Day 22/23/25 guardrail proofs |
| Memory bounded (growth/retention/supersedes caps) | Day 7/36 growth tests |
| Judge credible + corpus frozen + baseline reproducible | Day 29/30/39 reports |
| Specs v1.0 candidates, runbook, dev guide complete | Day 38 |

---

## 3. Tasks

### 3.1 Exit-criteria evidence run (120 min)

- [ ] Run the canonical test suite (`pnpm -r test`, architecture tests, guardrail proofs, E2E load) — full green.
- [ ] Walk the confirm list (§2) and map each criterion to its live evidence; write the result into `docs/reports/phase3-exit-review.md`.

### 3.2 Decision + tag (60 min)

- [ ] Record the exit decision (PASS / PASS-with-conditions / FAIL) with any conditions listed.
- [ ] On PASS: cut the release tag (`git tag v0.3.0`) at the verified commit. On FAIL: no tag; list blockers.

### 3.3 Phase-3 summary + retro (90 min)

- [ ] `docs/summary/` — Phase-3 summary (what closed the loop, key numbers, residual risks).
- [ ] `docs/retros/phase-03.md` — phase-level retro (what worked, what surprised, what v1.1 inherits).

### 3.4 Final index update (30 min)

- [ ] Update `README.md` + `docs/plan/phase-3/README.md` status to "complete" with the tagged release.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `docs/reports/phase3-exit-review.md` | Exit decision + evidence mapping |
| `docs/summary/` (Phase-3) | Phase-3 final summary |
| `docs/retros/phase-03.md` | Phase-level retro |
| `README.md` + `docs/plan/phase-3/README.md` (updated) | Status + tag |
| Git tag `v0.3.0` | Release tag (on PASS) |

---

## 5. Acceptance Criteria

- [ ] Confirm-list verified: all ten exit criteria evidenced (test/report), none asserted only.
- [ ] Full test suite green (unit, boundary, guardrail, E2E, reproducibility).
- [ ] Exit decision recorded as PASS / PASS-with-conditions / FAIL; conditions listed.
- [ ] PASS ⇒ release tag cut at the verified commit; FAIL ⇒ blockers listed, no tag.
- [ ] Phase summary + phase retro exist.
- [ ] README/phase-3-README status updated, tag referenced.

**Exit rule:** "Learning closed + demonstrable" is the phase's identity. If the loop is closed but every other invariant held — that's a FAIL. If the loop runs but a notable change self-applied during E2E — that's a FAIL. Evidence, not enthusiasm, decides.

---

## 6. Notes & Pitfalls

- **This is the one review that decides on evidence alone.** If a criterion can't be mapped to a passing test or a recorded report, it doesn't pass — no "we're pretty sure." The phase spent 40 days making every guarantee provable; the exit review cashes that in.
- **"Closed loop" ≠ "no humans."** Closed means the *learning loop* runs autonomously; the human gate remains the authority over task decisions. Conflating the two is a FAIL condition, not a semantic quibble.
- **PASS-with-conditions is legitimate, not a soft-pass.** A known residual risk with a clear owner and target version is fine to record. Calling it a clean PASS when it isn't sets up the next phase for a surprise.
- **The tag is on the verified commit, not the latest commit.** Cut the tag only after the exit-criteria run is green. A tag on an unverified commit makes the tag meaningless.
- **Phase-3 closing the loop is the end of the plan, not the end of the system.** The retro + summary should hand off residual risks and v1.1 candidates explicitly — the next phase (or the user) inherits them.
- **You've reached the end of the phase.** Congratulations — now make the summary useful to whoever operates this next.

---

*Prev: [Day 39 — Benchmark Regression + Judge-Agreement Report](day-39.md)*
