# Documentation

Index of everything under `docs/`. For a one-page overview, start at the root
[`README.md`](../README.md); this file is the table of contents for the deeper
material.

## Specifications & package docs

The **as-built** contract now lives in two places: the single architecture spec
here, and one `README.md` per package (the former one-spec-per-subsystem files are
retired).

| Where | Subject |
| --- | --- |
| [core/1_HAI_Harness_Architecture_v0.2](core/1_HAI_Harness_Architecture_v0.2.md) | Overall architecture, phases, exit criteria, subsystem→package map |
| `packages/orchestrator` … `packages/evaluation` | One `README.md` per built subsystem — see the mapping table in the architecture spec §5 |

The full package list (25 `@harness/*` packages + 2 apps) and their documentation
live under [`../packages/`](../packages/) — each `README.md` covers modules,
key invariants, and its boundary rules.

## Build plan (`plan/`)

Day-by-day plans, one file per day, across three phases — see
[`plan/README.md`](plan/README.md):

- Phase 1 — [README](plan/phase-1/README.md) · `day-01..30` (✅ complete)
- Phase 2 — [README](plan/phase-2/README.md) · `day-01..30` (✅ complete)
- Phase 3 — [README](plan/phase-3/README.md) · [backlog](plan/phase-3/backlog.md) · `day-01..40` (✅ complete — tagged `v0.3.0-harness`; [exit review](retros/phase3-exit-review.md))

## Architecture notes (`architecture/`)

- [wiring-map](architecture/wiring-map.md) — the DI object graph (living document)
- [artifact-tracker-vs-git](architecture/artifact-tracker-vs-git.md) — ADR: pre-commit truth vs post-merge Git
- [idempotency-audit](architecture/idempotency-audit.md) — per-table idempotency guard inventory

## Operations (`runbook/`)

- [README](runbook/README.md) — startup, oversight, incidents, escalation
- [operations](runbook/operations.md) — Phase-3 DevOps + audit procedures (v1.0-candidate)
- [audit-queries](runbook/audit-queries.md) — SQL cookbook for "what actually happened"
- [limitations](runbook/limitations.md) — known Phase-1 scope cuts

## Retrospectives (`retros/`)

Honest weekly/phase post-mortems — numbers and slips, not marketing.

## Summaries (`summary/`, tiếng Việt)

- [HAI_overview](summary/HAI_overview.md) — tổng quan kiến trúc
- [HAI_flow](summary/HAI_flow.md) — flow hoạt động end-to-end
- [harness-fit-analysis](summary/harness-fit-analysis.md) — bản đồ từ framework nguồn → HAI

## Developer guide

- [dev-guide](dev-guide.md) — clone-to-green in ~15 minutes