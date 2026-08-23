# Day 37 — E2E Full System under Phase-3 Infra + Load Profile

| | |
|---|---|
| **Week** | 8 — Harden + exit |
| **Spec refs** | Phase-3 README §7 (`pnpm test && pnpm lint && pnpm e2e` under full stack); Architecture §8 |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 36 (hardened), all Phase-3 subsystems (providers, write-back, verification, memory, judge, hybrid, loop) live |

---

## 1. Objectives

By end of day you will have:

1. A **full-system E2E** exercising the entire review flow under the Phase-3 stack: provider ingest (multi-host stub) → reviewer (read-only) → verification (clone/sandbox/targeted) → write-back (toggle) → memory (write/read) → judge → hybrid ranking → closed loop.
2. A **load profile** run (modest concurrency) proving the system holds up under simultaneous reviews without cross-request bleed, unbounded memory, or wedged sandboxes.
3. `pnpm e2e` green end-to-end with all Phase-3 flags/toggles defaulted safely.
4. A recorded E2E result in `docs/retros/`.

This is the "everything together" day before docs (Day 38) and the exit review (Day 40).

---

## 2. Design Decisions

### 2.1 One golden-path E2E, plus branch coverage

The E2E is a single recorded scenario (PR URL + Jira key → full flow → human decision → write-back → memory → judge → candidates) plus forced branches (verification FAILED non-blocking, write-back OFF, judge HOLD). Branch coverage matters more than volume here.

### 2.2 Load profile is correctness-under-concurrency, not a perf benchmark

A few concurrent reviews (e.g. 10) across two providers; assert isolation (no bleed), teardown (no leaked sandboxes), and bounded resource use. Perf benchmarking is out of scope — the point is "does it hold together under Phase-3 infra".

### 2.3 Safe defaults under E2E

`WRITEBACK` off-at-rest, `auto-approve` off, durable queue `inproc` (or a CI Redis if configured) — E2E must pass with the *safe* configuration, not a demo-max config.

### 2.4 Stubbed externals, real internals

External hosts (Git/Jira/LLM) are stubbed/fixtured in CI; every internal subsystem (db, event bus, sandbox, memory, judge, hybrid, loop) runs for real. This isolates the *system* from flaky externals while still exercising real seams.

---

## 3. Tasks

### 3.1 Golden-path E2E spec (120 min)

- [ ] `apps/api/e2e/` (or `e2e/`) — full flow scenario with real internals, stubbed externals.

### 3.2 Branch coverage (90 min)

- [ ] FAILED-non-blocking, write-back OFF, judge HOLD branches asserted.

### 3.3 Load profile (90 min)

- [ ] `e2e/load-profile.spec.ts` — concurrent reviews, isolation + teardown assertions.

### 3.4 Safe-defaults pass (30 min)

- [ ] Confirm E2E runs under off-at-rest toggles.

### 3.5 Evidence (30 min)

- [ ] `docs/retros/phase3-e2e.md` — results.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `e2e/full-system.spec.ts` | Golden-path + branches |
| `e2e/load-profile.spec.ts` | Concurrency + isolation |
| `docs/retros/phase3-e2e.md` | E2E results |

---

## 5. Acceptance Criteria

- [ ] `pnpm e2e` green end-to-end (real internals, stubbed externals).
- [ ] FAILED verification non-blocking, write-back OFF, and judge HOLD branches all asserted.
- [ ] Concurrent reviews show no config/token bleed + no sandbox leak.
- [ ] E2E passes under safe (off-at-rest) defaults.
- [ ] `pnpm test && pnpm lint && pnpm e2e` green.

---

## 6. Notes & Pitfalls

- **Stub externals, not the seams.** If you stub the event bus or the DB, the E2E tests nothing; only the *external* hosts/LLM may be stubbed.
- **Branch coverage is the real E2E value.** A single green happy path proves little; the FAILED/OFF/HOLD branches are where the discipline lives.
- **Load profile = isolation + teardown.** A concurrency run that leaks a sandbox or crosses tokens is a real defect even at low volume.
- **Day 38:** docs — specs to v1.0 candidates, runbook + dev guide.

---

*Next: [Day 38 — Docs: Specs to v1.0 Candidates, Runbook + Dev Guide](day-38.md)*