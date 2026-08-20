# HAI Harness — 30-Day Implementation Plan

**Version:** v0.1
**Created:** 2026-08-19
**Specs:** `docs/core/1..7, 9, 11` (updated v0.1, reviewed — see `docs/summary/core_docs_review.md`). Spec 9 = Memory/Evidence (evidence store in Phase 1); Spec 11 = Evaluation Engine (Phase 2+).

---

## 1. Goal of the 30 Days

By **Day 30**, deliver a working **vertical slice** of HAI Harness:

```text
Task → Context → AI Agent execution → Artifact/Change tracking
     → Independent Verification → Attention Assessment
     → Human Review → Decision (APPROVE → merge / REJECT → rework)
     → Evidence recorded & queryable
```

Not a production system — a **correctly-architected, tested, end-to-end demonstrable** modular monolith that proves the core principles:

- **Evidence before confidence** — no change is "done" without verification evidence.
- **Human Attention as a first-class resource** — every review request is prioritized by the Attention Engine.
- **Claim ≠ Evidence** — the AI's report is never trusted without independent verification.
- **Full provenance** — every artifact answers: who, what, why, which model, which context, which evidence.

---

## 2. Tech Stack (locked for the 30 days)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript (Node 20+) | Matches all specs; fast iteration |
| Repo | pnpm workspaces + Turborepo | Modular monolith with enforced boundaries |
| Database | PostgreSQL 16 (+ Drizzle ORM) | Durable state for tasks/artifacts/evidence |
| Events | In-process `IEventBus` (EventEmitter impl) | Per Orchestrator spec §8; swap for Kafka/NATS later |
| LLM | `LLMProvider` adapter; Anthropic SDK + MockLLM | Per Agent Runtime spec |
| Tests | Vitest | Fast, TS-native |
| API | Fastify | Lightweight REST for Review Interface |
| Web UI | React + Vite (minimal) | Review queue + diff viewer |
| Infra | Docker Compose (postgres only) | Keep dev setup to one command |

**Explicitly out of scope for 30 days:** multi-agent orchestration, embeddings/semantic search, Kafka, container-sandboxed verification, dependency-graph targeted verification, learning/calibration, Evaluation Engine (Spec 11).

> Phase model: the 30-day plan is **Phase 1** (prove the core loop). **Phase 2** builds the Evaluation Engine v0 (metrics + shadow A/B via trajectory Replay) + attention-calibration + hybrid semantic ranking behind the Ranker seam. **Phase 3** builds the full Memory subsystem (versioned write-back), targeted verification, trajectory Fork/Resume, benchmark corpus + LLM-as-judge quality signals, and the closed learning loop. See Spec 1 §24 for exit criteria.

---

## 3. Repository Layout (target, built incrementally)

```text
harness/
├── apps/
│   ├── api/                  # Fastify server (review queue, decisions, queries)
│   └── web/                  # React review interface
├── packages/
│   ├── domain/               # Shared types: Task, Change, Artifact, IDs, events
│   ├── event-bus/            # IEventBus + in-process implementation
│   ├── db/                   # Drizzle schema + migrations + repositories
│   ├── orchestrator/         # Task/Work Orchestrator (spec 2)
│   ├── agent-runtime/        # AI Agent Runtime (spec 3)
│   ├── context-engine/       # Context Engine (spec 4)
│   ├── artifact-tracker/     # Artifact/Change Tracker (spec 5)
│   ├── attention-engine/     # Attention Engine (spec 6)
│   ├── verification-engine/  # Verification Engine (spec 7)
│   └── review/               # Human Review backend (queue, decisions)
├── fixtures/                 # Sample target project the agent works on
└── docker-compose.yml
```

**Dependency rule (enforced by tooling, Day 5):** packages may only depend inward — `domain`, `event-bus`, `db` have no outgoing deps to other packages; engines never import each other, they integrate via events + orchestrator.

---

## 4. Weekly Milestones

| Week | Theme | Milestone (demo-able at week's end) |
|------|-------|-------------------------------------|
| **W1 (D1–7)** | Foundation | Task CRUD persisted in Postgres; canonical state machine with transition validation; events flowing on IEventBus |
| **W2 (D8–14)** | Execution core | Orchestrator dispatches a task → Mock/Real LLM agent runs ReAct loop with tools → artifacts recorded with content hashes |
| **W3 (D15–21)** | Trust pipeline | Change verified independently (tsc + tests) → evidence stored → Attention Engine scores & routes → context snapshot served to agent |
| **W4 (D22–30)** | Human loop + E2E | Web UI review queue with diffs → approve/reject drives merge/rework → full vertical slice demo + hardening + docs |

---

## 5. Daily Files

Each day has its own file with objectives, tasks, deliverables, and acceptance criteria:

| Day | File | Focus |
|-----|------|-------|
| 1 | [day-01.md](day-01.md) | Monorepo scaffold, tooling, CI skeleton |
| 2 | [day-02.md](day-02.md) | `packages/domain` — core types & branded IDs |
| 3 | [day-03.md](day-03.md) | Event model + `IEventBus` |
| 4 | [day-04.md](day-04.md) | PostgreSQL schema + migrations |
| 5 | [day-05.md](day-05.md) | Module boundaries + DI + dependency enforcement |
| 6 | [day-06.md](day-06.md) | Canonical Task state machine |
| 7 | [day-07.md](day-07.md) | Week 1 integration checkpoint |
| 8 | [day-08.md](day-08.md) | Orchestrator core: queue + pull dispatch |
| 9 | [day-09.md](day-09.md) | Linear workflow execution |
| 10 | [day-10.md](day-10.md) | Retry, failure, idempotency |
| 11 | [day-11.md](day-11.md) | LLMProvider adapter + MockLLM |
| 12 | [day-12.md](day-12.md) | ReAct loop |
| 13 | [day-13.md](day-13.md) | Tools + TrajectoryRecorder |
| 14 | [day-14.md](day-14.md) | Artifact Tracker Phase 1 + Week 2 checkpoint |
| 15 | [day-15.md](day-15.md) | Verification Engine: request handler + compile check |
| 16 | [day-16.md](day-16.md) | Test executor, timeouts, flaky handling |
| 17 | [day-17.md](day-17.md) | Evidence storage + provenance linking + diff engine |
| 18 | [day-18.md](day-18.md) | Attention Engine scoring (Phase 1 factors) |
| 19 | [day-19.md](day-19.md) | AttentionPolicy rules + routing |
| 20 | [day-20.md](day-20.md) | Context Engine: collect → rank → budget |
| 21 | [day-21.md](day-21.md) | Context delivery, freshness + Week 3 checkpoint |
| 22 | [day-22.md](day-22.md) | Review backend: queue API + decisions |
| 23 | [day-23.md](day-23.md) | Review UI: queue + diff view |
| 24 | [day-24.md](day-24.md) | Decision flow: merge on approve, rework on reject |
| 25 | [day-25.md](day-25.md) | E2E vertical slice — happy path |
| 26 | [day-26.md](day-26.md) | E2E — failure paths + provenance query UI |
| 27 | [day-27.md](day-27.md) | Observability: logs, correlation IDs, audit queries |
| 28 | [day-28.md](day-28.md) | Hardening: concurrency, failure injection, load smoke |
| 29 | [day-29.md](day-29.md) | Documentation: specs → v0.2, dev guide, runbook |
| 30 | [day-30.md](day-30.md) | Final demo + retrospective + Phase 2 backlog |

---

## 6. How to Use This Plan

1. **One file per day.** Start the day by reading the file end-to-end before coding.
2. **Acceptance criteria are the contract.** A day is "done" only when every criterion passes; if not, carry the remainder into the next morning — do not silently skip.
3. **Specs are the source of truth.** Each daily file references the relevant spec sections. If implementation reveals a spec problem, fix the spec first (this is how specs reach v0.2 on Day 29).
4. **Checkpoints are non-negotiable.** Days 7, 14, 21 are integration checkpoints: stop feature work, make the week's slice demonstrable, fix integration debt immediately.
5. **Tests are part of the deliverable,** not a follow-up. Every package ships with unit tests; checkpoints add integration tests.

## 7. Day-30 Success Criteria (definition of done)

- [ ] `docker compose up && pnpm dev` starts the whole system with one fixture project.
- [ ] Scripted demo: create task → agent executes → change verified → scored → reviewed in UI → approved → merged, with provenance chain queryable end-to-end.
- [ ] Reject path demo: verification failure → task REWORK → retry limit → AWAITING_HUMAN_INTERVENTION.
- [ ] All packages ≥ 70% line coverage on core logic (state machine, scoring, verification parsing).
- [ ] Specs updated to v0.2 reflecting as-built reality; known gaps documented as Phase 2 backlog.
- [ ] Spec 9 (Memory/Evidence) preserved: evidence store is append-only and queryable end-to-end; Memory subsystem explicitly deferred to Phase 3.
- [ ] Spec 11 (Evaluation Engine) left as a Phase-2 seam only: event log, evidence, and decision log are recorded such that offline metrics can later be computed without schema rework.
