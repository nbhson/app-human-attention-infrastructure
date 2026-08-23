# Day 38 — Docs: Specs to v1.0 Candidates, Runbook + Dev Guide

| | |
|---|---|
| **Week** | 8 — Harden + exit |
| **Spec refs** | Architecture §6 (package README = spec); Phase-3 README §8 (docs); runbook/dev-guide |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 37 (E2E green); all Phase-3 subsystems built |

---

## 1. Objectives

By end of day you will have:

1. The changed/new package READMEs (git-provider, ticket-provider, writeback, memory, code-index, judge, benchmark, context-engine, attention-engine, verification-engine, db) promoted to **v1.0-candidate** status — reflecting the Phase-3 reality, not the phase-2 sketches.
2. An updated **operators runbook** covering the new operational surface: `provider_configs` (token rotation/redaction), write-back toggle + `writeback_log` audit, learning-loop schedule + HOLD handling, durable-queue flag.
3. An updated **dev guide** for the clone-to-green path under the Phase-3 stack (new env vars, new tables, tree-sitter, durable-queue opt-in).
4. The wiring map reconciled with every new token/event/table.

Documentation reflects the *built* system, not the plan.

---

## 2. Design Decisions

### 2.1 Package READMEs are the specs — update them first

The architecture's §6 made per-package READMEs the source of truth. Each new/changed package README gets its as-built status, modules, data models, lifecycle, and boundary rule — the "Planned (later phases)" stubs removed or re-scoped to future work.

### 2.2 Runbook is operator-first

New runbook sections are procedural: rotate a provider token (re-encrypt + rotate key), prove write-back OFF, read `writeback_log`, interpret a learning-loop HOLD, flip `rank_method` back to `keyword` (kill-switch), enable/disable the durable queue. Every entry has a "why" + a concrete command.

### 2.3 Dev guide is clone-to-green, incl. new deps

Tree-sitter grammars, `HARNESS_CONFIG_KEY`, `EVENT_TRANSPORT`, and any new test fixtures must be in the dev-guide path or a fresh clone fails green.

### 2.4 Specs to v1.0 *candidate* (not final)

Mark these as candidates pending the Day 39 regression + Day 40 exit review — v1.0 confers only after the phase closes.

---

## 3. Tasks

### 3.1 Package README promotion (120 min)

- [ ] Update the 7 new + 4 changed package READMEs to as-built v1.0-candidate.

### 3.2 Runbook (90 min)

- [ ] New operational sections (token rotation, write-back audit, loop HOLD, kill-switch, queue).

### 3.3 Dev guide (60 min)

- [ ] Clone-to-green with new env/deps/tables.

### 3.4 Wiring map reconcile (45 min)

- [ ] Every new TOKEN/event/table reconciled.

### 3.5 Review pass (30 min)

- [ ] Cross-check docs against built code (spot-grep).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/*/README.md` (7 new + 4 changed) | As-built v1.0-candidate specs |
| `docs/runbook/*.md` | Operator procedures |
| `docs/dev-guide.md` | Clone-to-green update |
| `docs/architecture/wiring-map.md` | Reconciled |

---

## 5. Acceptance Criteria

- [ ] Every new/changed package README reflects the as-built Phase-3 system (no "Planned" stubs).
- [ ] Runbook covers token rotation, write-back audit, loop HOLD, `rank_method` kill-switch, queue flag.
- [ ] A fresh clone reaches green with only documented env/deps.
- [ ] Wiring map lists every new token/event/table.
- [ ] All docs mark v1.0 *candidate* (pending Day 40).

---

## 6. Notes & Pitfalls

- **Docs describe what's built, not what was planned.** Sweep for "will"/"later"/"Planned" and either build it, delete it, or explicitly mark it future work.
- **Runbook entries need a "why", not just a command.** An operator deciding whether to HOLD or PROMOTE needs the reasoning, not just the button.
- **Clone-to-green is the doc's acceptance test.** If a fresh clone can't go green from the dev guide, the dev guide is wrong.
- **Day 39:** benchmark regression + judge-agreement report.

---

*Next: [Day 39 — Benchmark Regression + Judge-agreement Report](day-39.md)*