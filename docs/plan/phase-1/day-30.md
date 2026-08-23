# Day 30 — Tag v0.1.0-harness + Phase 2 backlog

| | |
|---|---|
| **Week** | W4 — Human loop + E2E |
| **Spec refs** | Spec 1 §9 (delivery status), plan README §7 (definition of done) |
| **Estimated effort** | 4h |
| **Prerequisites** | Day 29 (demo rehearsed + retrospective filed) |

---

## 1. Objectives

- Verify every Day-30 success criterion is met and cut the `v0.1.0-harness` tag.
- Finalize the **Phase 2 backlog** from the retrospective: Evaluation Engine, attention calibration, semantic ranking — with the seams left in Phase 1 documented.
- Lock the release narrative: review-first control plane, evidence-before-confidence, human in the loop, AI read-only.
- Confirm the retired code-generation path is absent from the tag's foreground and from the backlog's "future work".

## 2. Design Decisions

- Tagging is gated on the full definition of done, not on calendar: coverage ≥ 70% on core logic, specs at v0.2, the reject-path demo working, append-only evidence preserved, no live keys.

```text
done = docker compose up && pnpm dev                         ✓ one command
     + scripted PR → report → decision demo                  ✓ queryable provenance
     + reject path (verification fails → flagged → decided)  ✓
     + Spec 9 evidence append-only; Spec 11 seam-only        ✓
     + .env.example placeholders; tokens redacted            ✓
```

- The Phase 2 backlog keeps Phase 1 honest: Spec 11 (Evaluation Engine) is left as an event/evidence/decision-log seam so offline metrics can be computed later without schema rework.

## 3. Tasks

### 3.1 Criterion verification (90 min)
- [ ] Walk the §7 checklist; record coverage + demo run output

### 3.2 Backlog finalization (90 min)
- [ ] `docs/plan/phase-2/README.md` — Evaluation v0, calibration, semantic ranking, auto-approve
- [ ] `docs/plan/phase-3/README.md` — GitLab/Bitbucket, Jira write-back, embeddings (deferred)

### 3.3 Tag + release note (60 min)
- [ ] `git tag v0.1.0-harness` + annotated release note

## 4. Deliverables

| File | Description |
|------|-------------|
| `docs/plan/phase-2/README.md` | Phase 2 backlog |
| `docs/plan/phase-3/README.md` | Phase 3 deferral pointer |
| `docs/plan/README.md` | (updated) phase index |
| `git tag v0.1.0-harness` | Release tag |

## 5. Acceptance Criteria

- [ ] All 9 Day-30 success criteria from the plan README §7 are demonstrably met
- [ ] `git tag -l v0.1.0-harness` lists the tag; `pnpm --filter @harness/api test` is green at the tag
- [ ] Phase 2/3 backlogs name Evaluation, calibration, semantic ranking, provider breadth, and write-back — and never re-introduce code generation

## 6. Notes & Pitfalls

- Only tag green: if a criterion fails, carry it into the morning and re-run — do not silently skip and tag.
- The backlog inherits Phase 1's evidence-first stance; code generation stays retired, not "temporarily paused".

---

*End of Phase 1.*