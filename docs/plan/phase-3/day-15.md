# Day 15 — Week 3 Checkpoint: Real PR Tests in Sandbox, Faster + Still Correct

| | |
|---|---|
| **Week** | 3 — Verification breadth |
| **Spec refs** | Phase-3 README §5 (W3 milestone), §7 (verification breadth exit criterion) |
| **Estimated effort** | 5h |
| **Prerequisites** | Days 11–14 (clone, sandbox run, FAILED→flag, dependency graph targeted verify) |

---

## 1. Objectives

By end of day you will have:

1. A demonstrable Week-3 milestone: **clone a real PR → run its own build/test in the Docker sandbox → targeted (dependency-graph) subset where provable, full suite otherwise → FAILED flags the report with evidence, non-blocking.**
2. An end-to-end demo over a recorded fixture repo proving both legs: full-suite correctness AND targeted speedup (measured fewer tests, same verdicts).
3. Integration debt closed: clone errors surfaced, teardown guaranteed, evidence links valid, FAILED non-blocking verified end-to-end.
4. W3 evidence in `docs/retros/`; wiring map notes `cloneAndCheckout` + `TargetedVerifier` + `code-index`.

The checkpoint makes "real PR tests in sandbox, faster + still correct" *measurable and demonstrated*.

---

## 2. Design Decisions

### 2.1 The demo is a correctness + latency report, not a green light

`scripts/demo-verification.ts` runs both full and targeted paths over the fixture, prints: verdicts (must agree), test counts (targeted ≤ full), wall-clock (targeted faster), and one intentionally-failing fixture (FAILED → report flag, item still reaches AWAITING_REVIEW).

### 2.2 "Still correct" is the hard criterion

The checkpoint accepts the speedup claim **only** on the equivalence fixture: targeted verdict == full verdict on every case. Speed without matching verdicts is a regression, not a win.

### 2.3 The FAILED fixture is part of the demo

Include a PR whose tests genuinely fail; assert it (a) doesn't auto-reject and (b) carries evidence. The non-blocking invariant is demonstrated, not asserted in a unit test alone.

---

## 3. Tasks

### 3.1 End-to-end demo (90 min)

- [ ] `scripts/demo-verification.ts` — clone → full vs targeted → equivalence + latency report + failing fixture.

### 3.2 Equivalence re-check (45 min)

- [ ] Run the Day-14 equivalence fixtures through the integrated path (not just unit tests).

### 3.3 Integration debt pass (60 min)

- [ ] Clone error surfacing; teardown-on-panic; evidence refs resolve; FAILED non-blocking end-to-end.

### 3.4 Docs + evidence (45 min)

- [ ] `docs/architecture/wiring-map.md` — add `cloneAndCheckout`, `TargetedVerifier`, `code-index`.
- [ ] `docs/retros/phase3-w3.md` — recorded demo numbers.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo-verification.ts` | Clone → sandbox verify → targeted/full demo |
| `docs/architecture/wiring-map.md` (updated) | Verification-breadth seams |
| `docs/retros/phase3-w3.md` | Week 3 checkpoint evidence |

---

## 5. Acceptance Criteria

- [ ] `pnpm demo:verification` clones a fixture PR, runs sandbox build/test.
- [ ] Targeted verdicts match full verdicts on equivalence fixtures, with fewer tests.
- [ ] Failing fixture: report flagged with evidence, item reaches AWAITING_REVIEW (not auto-rejected).
- [ ] Teardown + evidence links verified end-to-end.
- [ ] `pnpm test && pnpm lint` green; wiring map updated.

---

## 6. Notes & Pitfalls

- **Never claim "faster" without the equivalence table.** The checkpoint slides must show verdict parity next to test-count/latency, or the speedup is unearned.
- **Don't skip the failure path in the demo.** A demo that only shows green builds hides the FAILED→flag→non-blocking guarantee that is the actual deliverable.
- **Week 4 pivots to review memory** — the clone/verify machinery is now stable; don't refactor it mid-phase.
- **Next (Day 16):** review-memory model (reviews/findings/decisions tiers).

---

*Next: [Day 16 — Review-memory Model: Reviews/Findings/Decisions Tiers](day-16.md)*