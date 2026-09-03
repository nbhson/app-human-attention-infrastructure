# Documentation

Index of everything under `docs/`. For a one-page overview, start at the root
[`README.md`](../README.md); this file is the table of contents for the deeper
material.

## Specifications & package docs

The **as-built** contract now lives in two places: the single architecture spec
here, and one `README.md` per package (the former one-spec-per-subsystem files are
retired).

| Where                                                                                       | Subject                                                                                 |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [architecture/HAI_Harness_Architecture_v0.6](architecture/HAI_Harness_Architecture_v0.6.md) | Overall architecture, phases, exit criteria, subsystem→package map                      |
| `packages/orchestrator` … `packages/evaluation`                                             | One `README.md` per built subsystem — see the mapping table in the architecture spec §5 |

The full package list (25 `@harness/*` packages + 2 apps) and their documentation
live under [`../packages/`](../packages/) — each `README.md` covers modules,
key invariants, and its boundary rules.

## Architecture notes (`architecture/`)

- [wiring-map](architecture/wiring-map.md) — the DI object graph (living document)
- [runtime-startup](architecture/runtime-startup.md) — which packages load at start and how they depend on each other
- [artifact-tracker-vs-git](architecture/artifact-tracker-vs-git.md) — ADR: pre-commit truth vs post-merge Git
- [idempotency-audit](architecture/idempotency-audit.md) — per-table idempotency guard inventory

## Operations (`runbook/`)

- [README](runbook/README.md) — startup, oversight, incidents, escalation
- [users-permissions](runbook/users-permissions.md) — user model, role hierarchy, route permissions, and common operations
- [operations](runbook/operations.md) — DevOps + audit procedures (v1.0-candidate)
- [audit-queries](runbook/audit-queries.md) — SQL cookbook for "what actually happened"
- [limitations](runbook/limitations.md) — known scope cuts

## Retrospectives (`retros/`)

Honest weekly/phase post-mortems — numbers and slips, not marketing.

## Summaries (`summary/`)

- [HAI_overview](summary/HAI_overview.md) — architecture overview
- [HAI_flow](summary/HAI_flow.md) — end-to-end operational flow
- [harness-fit-analysis](summary/harness-fit-analysis.md) — source framework → HAI mapping

## Developer guide

- [dev-guide](dev-guide.md) — clone-to-green in ~15 minutes
