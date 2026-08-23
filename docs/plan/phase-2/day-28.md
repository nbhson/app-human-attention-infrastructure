# Day 28 — Docs: Bump Changed Specs to v0.3 + Dev Guide & Runbook

| | |
|---|---|
| **Week** | 6 — Harden + exit review |
| **Spec refs** | Spec 1 §24 (roadmap/exit criteria), Spec 8 (new, Day 24), Spec 10 (new, Day 10); bumped specs: 2, 4, 5, 6, 7, 9, 11 |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 21–27 (all Phase-2 changes); Day 10 (Spec 10), Day 24 (Spec 8) already written |

---

## 1. Objectives

By end of day you will have:

1. **Version bumps** — every spec that Phase 2 materially changed moves to `v0.3` (or gains a `v0.2` changelog where it only *gained* a section). Spec 8 and Spec 10 already exist at v0.1 (written Days 10/24).
2. A **changelog discipline** — each bumped spec carries a `## Changelog` noting exactly which Phase-2 day introduced which change, so a reader can trace "why does §5.1 now say semantic is shadow-only" back to Day 18's invariants.
3. An updated **dev guide** reflecting the new infra (auth, observability, sandbox, object store, review-report store, cache, eval) and the wiring map's R7–R12 boundary rules.
4. A **runbook** that says how to operate the system: boot the subsystems (MinIO, pgvector, sandbox daemon), read the metrics, and respond to the alerts Day 26 wired.

Day 28 ensures the implementation has a *spec* and the operator has a *runbook* — without both, Day 30's exit review can't be meaningfully reviewed by a teammate who didn't watch the phase unfold.

---

## 2. Design Decisions

### 2.1 What bumps, and how far

| Spec | Phase-2 change | New version |
|------|----------------|-------------|
| 2 Orchestrator | §7 circuit-breaker now also covers sandbox/eval degradation | v0.3 |
| 4 Context | §5.1 semantic shadow (Day 18), §5.2.3 cache (Day 20), §8 tiktoken (Day 19) | v0.3 |
| 5 Artifact | §4.2 object store backend (Day 21) | v0.2 (gained section) |
| 6 Attention | §4.1 auto-approve gate (Days 13–14), §4.1 thresholds | v0.2 (gained section) |
| 7 Verification | §5.5 sandbox (Day 22) | v0.3 |
| 9 Memory Evidence | §3.1 evidence now content-addressed via `ContentStore` (review reports + large diffs, Day 23) + `content_hash` | v0.3 |
| 11 Evaluation | §4 metrics realized (Days 6–7), §5 shadow harness + review replay (Days 8–10, 29), §6 closed loop (Days 11–15) | v0.3 |

**Note:** Spec 3 (Agent Runtime) is **not** bumped. Its Phase-2-adjacent changes were the retired Code-Mode sandbox (dropped from the contract) and the replay surface (folded into Spec 11 §5's review replay). A spec is bumped only for material, current changes.

Only *material* changes bump; a `v0.2` spec that merely cross-references a new section gets a changelog line, not a version jump. Version noise is what erodes trust in the version numbers.

### 2.2 The changelog is the traceability mechanism

Each bumped spec appends:

```markdown
## Changelog
- v0.3 (Day 18): §5.1 — semantic ranker shadow-only; `rank_method` default unchanged (`keyword`).
- v0.3 (Day 19): §8 — tiktoken replaces `chars/4`.
```

The changelog entry cites the *day*, which is the unit Phase 2 documented everything in. A reader can jump from spec → `docs/plan/phase-2/day-NN.md` → acceptance criteria → test.

### 2.3 Dev guide = how to run it; runbook = how to keep it alive

The dev guide (`docs/guides/dev.md`) covers the happy path: `docker compose up` (Postgres + pgvector + MinIO + sandbox daemon), migrations, seeding the E2E fixture, running per-package tests. The runbook (`docs/guides/runbook.md`) covers the unhappy path: what each Day-26 alert means, how to diagnose the three fallbacks (semantic→keyword, object→db, sandbox→in-process), and how to flip the auto-approve kill-switch.

---

## 3. Tasks

### 3.1 Spec bumps + changelogs (150 min)

- [ ] Bump each spec in §2.1's table; append a `## Changelog` with day-cited entries.
- [ ] Add the `docs/architecture/wiring-map.md` R7–R12 boundary rules if not already present (they were introduced incrementally Days 1–23; consolidate).

### 3.2 Dev guide (105 min)

- [ ] `docs/guides/dev.md` — boot order, migrations, fixture seed, per-package test commands, the sandbox image build.

### 3.3 Runbook (105 min)

- [ ] `docs/guides/runbook.md` — alert→diagnosis→response for each Day-26 contract; auto-approve kill-switch procedure; fallback inspection commands (`context_semantic_fallback_total`, etc.).

### 3.4 Cross-link audit (60 min)

- [ ] Verify every spec's changelog links to a real `day-NN.md`; verify no spec cites a section number that doesn't exist (grep the section headers).

### 3.5 Docs lint (45 min)

- [ ] A markdown link-check across `docs/` (broken internal link CI gate); fix any dangling refs.

---

## 4. Deliverables

| File/Pattern | Description |
|------|-------------|
| `docs/core/{2,4,7,9,11}_*.md` → v0.3 | Bumped + changelog |
| `docs/core/{5,6}_*.md` → v0.2 | Gained sections + changelog |
| `docs/architecture/wiring-map.md` | R7–R12 consolidated |
| `docs/guides/dev.md` | Dev guide |
| `docs/guides/runbook.md` | Runbook |

---

## 5. Acceptance Criteria

- [ ] Each spec in §2.1's table carries a `## Changelog` with at least one day-cited entry; versions match the table.
- [ ] `grep -L "## Changelog"` over `docs/core/*.md` for the *Phase-2-touched* specs is empty (every touched spec has one); Spec 3 is **not** bumped and carries no Code-Mode/replay changelog line.
- [ ] No spec cites a nonexistent section — the cross-link audit passes (grep drives it).
- [ ] `wiring-map.md` contains the R7–R12 boundary rules verbatim-consistent with the day files.
- [ ] Dev guide boots the stack and runs the E2E fixture; runbook documents each Day-26 alert with a response.
- [ ] Markdown link-check across `docs/` passes (no dangling internal links).
- [ ] `pnpm lint` green (docs lint step included).

---

## 6. Notes & Pitfalls

- **Version numbers only matter if they're honest.** Bumping everything to v0.3 "for consistency" makes v0.3 mean nothing. Bump only material changes; an untouched spec that got bumped is a lie a future reader will uncover mid-incident. Spec 3 stays put because its Phase-2-adjacent changes are retired or re-homed.
- **The changelog's unit is the *day*, not the PR.** Phase 2's traceability runs spec → `day-NN.md` → acceptance criteria → test. If the changelog cites PR numbers or vague "updated" text, the chain breaks at the first hop.
- **Docs are part of the exit criteria, not a nice-to-have.** Day 30's exit review asks "is the system reviewable by someone who wasn't here?" If the dev guide can't actually boot the stack step-by-step, the answer is no and Phase 3 inherits a black box.
- **A runbook that only documents happy states is a lie.** The valuable half is the unhappy path: what *each alert means* and *what to do*. "Check the logs" is not a response — a response names the command and the expected output.
- **Cross-link audibility beats prose.** Broken section refs accumulate silently across 30 days; the link-check + section-grep audit is what keeps the spec set navigable. Make it a CI gate, not a one-off.
- **Next (Day 29):** A/B dry-run end-to-end — compare two context-ranking variants head-to-head through the Day-9 harness for real.

---

*Prev: [Day 27 — E2E Under Phase-2 Infra](day-27.md) | Next: [Day 29 — A/B Dry-Run End-to-End](day-29.md)*