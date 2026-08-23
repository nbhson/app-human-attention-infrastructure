# Day 40 — Phase-3 Exit Review: Learning Closed + Demonstrable; Tag Release

| | |
|---|---|
| **Week** | 8 — Harden + exit |
| **Spec refs** | Architecture §24.3 (Phase-3 exit criteria); Phase-3 README §7 (exit criteria list) |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 36–39 complete; all seven Phase-3 exit criteria green |

---

## 1. Objectives

By end of day you will have:

1. A **Phase-3 exit review** — walk the seven `README §7` exit criteria against live evidence, marking each met/not-met with its proof.
2. The headline criterion demonstrated live: **the Learning loop closes automatically** (decisions + judge signals → calibration/routing, observed + re-entered), with the human APPROVE/REJECT gate untouched and `AUTO_APPROVABLE` the only (still-sampled) auto-path.
3. A phase-3 metrics checkpoint + retro, and the **`v0.3.0-harness` tag** (or the agreed next version) on the green commit.
4. Carried-forward items (any not-met criterion) written into the backlog for the next phase.

The exit review *decides* whether the phase is done; it doesn't rubber-stamp.

---

## 2. Design Decisions

### 2.1 Evidence over summary

Each of the seven exit criteria is checked by a *named artifact* (demo output, A/B report, e2e result, benchmark report, retro) — not a verbal claim. Criteria without artifacts are "not demonstrated", and the review says so.

### 2.2 The review is a decision gate

Output is explicit: **EXIT-GREEN** (all criteria met) or **EXIT-WITH-CARRYFORWARD** (some not-met, listed). If the Learning step or the write-back/hybrid criteria are not demonstrable, the phase holds — the review, not the calendar, gates the tag.

### 2.3 Reviewer-read-only is restated, not assumed

The exit review re-checks the phase's moral core: write-back wrote commentary/status only, verification ran the PR's own tests + flagged, memory holds reviews (not code-gen state), judge/benchmark measured review quality. Any violation is a blocker.

### 2.4 Tag on green

`v0.3.0-harness` is tagged only on a commit where `pnpm test && pnpm lint && pnpm e2e` is green, after the criteria checklist is signed.

---

## 3. Tasks

### 3.1 Criteria walk (120 min)

- [ ] Go through each `README §7` criterion against its artifact; mark met/not-met.

### 3.2 Live Learning-loop demo (45 min)

- [ ] Re-run the Day 35 closed-loop demo; confirm human gate untouched.

### 3.3 Metrics checkpoint + retro (60 min)

- [ ] `docs/retros/phase3-exit-review.md` — criteria table + metrics + carries.

### 3.4 Final green run (30 min)

- [ ] `pnpm test && pnpm lint && pnpm e2e` on the release commit.

### 3.5 Tag + backlog carry (30 min)

- [ ] Tag `v0.3.0-harness` (on green); write any carried items into the backlog.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `docs/retros/phase3-exit-review.md` | Criteria table + metrics + proof links |
| `docs/plan/README.md` (updated) | Phase 3 marked complete |
| `git tag` | `v0.3.0-harness` (on green commit) |
| `docs/plan/backlog.md` (if any carry) | Carried-forward items |

---

## 5. Acceptance Criteria

- [ ] All seven `README §7` criteria marked met/not-met with a named artifact each.
- [ ] Learning loop demonstrably closes; human APPROVE/REJECT gate proven untouched.
- [ ] Reviewer-read-only re-verified across write-back/verification/memory/judge.
- [ ] `pnpm test && pnpm lint && pnpm e2e` green on the tagged commit.
- [ ] `v0.3.0-harness` tagged; carries (if any) in the backlog.

---

## 6. Notes & Pitfalls

- **The review, not the calendar, gates the tag.** If a core criterion is not demonstrable, EXIT-WITH-CARRYFORWARD is the honest result — never ship a tag to meet a date.
- **Every criterion needs an artifact.** "Seems to work" is not evidence; a broken demo link is a not-met criterion.
- **Restate the moral core.** Re-verify the read-only invariant and the human gate before calling review-only the phase "done" — this is the whole point of the reorient.

---

*End of Phase 3.*