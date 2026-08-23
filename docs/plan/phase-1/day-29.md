# Day 29 — Final demo + retrospective

| | |
|---|---|
| **Week** | W4 — Human loop + E2E |
| **Spec refs** | Spec 1 §2 (core loop), plan README §7 (Day-30 criteria) |
| **Estimated effort** | 5h |
| **Prerequisites** | Days 01–28 (whole slice built + documented) |

---

## 1. Objectives

- Run the scripted demo end-to-end against the Day-30 success criteria and record the result.
- Write an honest retrospective of Phase 1: what held, what broke, and what the Phase 2 plan must re-work.
- Confirm the demo narrative is the **review loop**, and that "the AI never writes code" is visible in the walkthrough.
- Capture as-built evidence (coverage, demo output) for the Day 30 tag.

## 2. Design Decisions

- The demo is the plan README's scripted path, not an improvisation: paste PR URL → fetch diff + requirement → verified → scored → reviewed in UI → decision recorded, with provenance queryable end-to-end.

```text
docker compose up && pnpm dev → paste PR URL (+ Jira)
→ AI review (report + findings + suggestions)
→ verification evidence → attention label → human decision → provenance trace
```

- The retrospective is filed under `docs/retros/` and feeds the Phase 2 backlog (Day 30) — no silent heroics, keep failures visible.

## 3. Tasks

### 3.1 Dress rehearsal (90 min)
- [ ] Run the full demo on a clean checkout; time + capture each hop

### 3.2 Retrospective (90 min)
- [ ] `docs/retros/phase-1.md` — worked / broke / changed for Phase 2
- [ ] Harvest concrete backlog items for Day 30

### 3.3 Demo polish (60 min)
- [ ] Fix any demo-only rough edges (copy, ordering) surfaced in rehearsal

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo-review.ts` | (polished) demo runner |
| `docs/retros/phase-1.md` | Phase 1 retrospective |
| `docs/plan/phase-2/README.md` | (draft) Phase 2 entry note |

## 5. Acceptance Criteria

- [ ] The scripted demo runs clean on a clean checkout and reaches a recorded decision
- [ ] `docs/retros/phase-1.md` exists and is honest about gaps
- [ ] The demo visibly frames the AI as reviewer, not author

## 6. Notes & Pitfalls

- The demo is the artifact the tag (Day 30) points at — if it can't run clean today, do not tag a broken build tomorrow.
- Retrospective is input to backlog, not blame: translate every finding into a Phase 2 item.

---

*Next: [Day 30 — Tag v0.1.0-harness + Phase 2 backlog](day-30.md)*