# E2E Tests

> **Scope:** 7 specs that exercise the real DI graph against a real Postgres. They are **not** unit tests — see `vitest.config.ts` (root) vs `e2e/vitest.config.ts` (this folder).

## How e2e differs from `pnpm test`

|  | `pnpm test` (unit + integration) | `pnpm e2e` |
|---|---|---|
| **Config** | `vitest.config.ts` — `packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts` | `e2e/vitest.config.ts` — `e2e/**/*.spec.ts` only |
| **DB** | Isolated `harness_test_*` schema per test file (`@harness/db/test-utils`) | Same — each spec allocates its own isolated schema |
| **Graph** | Real container but many seams stubbed per-suite | Real container + real `EventBus`/`EventLogWriter`/`ReviewIngestService`; LLM + Git/Jira + WriteBack stubbed declaratively |
| **Parallelism** | File-parallel (default) | `fileParallelism: false` — serial, to avoid contention on `vector` extension install |

## Prerequisites

```sh
docker compose up -d          # Postgres :5432 must be live
pnpm --filter @harness/db migrate
pnpm build                    # e2e resolves @harness/* via dist/ (see vitest.config.ts alias)
```

`DATABASE_URL` must be set (from `.env`). No other env is required — e2e **does not** read `mcp.config.json`:

```sh
# CI parity: point MCP registry at a non-existent file so the harness boots
# with an empty registry (same as local dev without mcp.config.json).
MCP_CONFIG_PATH=/nonexistent/mcp.config.json pnpm e2e
```

This is what `e2e/full-system.spec.ts:212` does internally before `bootContainer()`:

```ts
process.env.MCP_CONFIG_PATH = '/nonexistent/mcp.config.json';
container.repoint(TOKENS.Db, isolatedDb);
container.repoint(TOKENS.LLMProvider, mockLlm);
container.repoint(TOKENS.GitProvider, stubGitProvider);
```

## Running

```sh
pnpm e2e                          # all 7 specs, serial, ~80s
pnpm e2e -- e2e/full-system.spec.ts   # single file
pnpm e2e -- -t "golden path"          # single test by name
```

`e2e/vitest.config.ts` sets `testTimeout: 30_000` per spec — a single spec may legitimately take 20s (real container + DB).

## The 7 specs

| Spec | What it proves |
|---|---|
| `full-system.spec.ts` (566 lines) | Golden path + 3 branch proofs through the real `ReviewIngestService` with a **DUAL_VALID** mock LLM document (64-entry `mockTextResponse` that satisfies both review + judge parsers regardless of async resolution order). Background writers (`MemoryIngestor`, `ReviewVerificationService`) are no-ops to avoid FK races on `resetReviewTables`. |
| `auto-approve.spec.ts` | `AUTO_APPROVABLE` → `AUTO_APPROVED` sampling + kill-switch |
| `verification-failure.spec.ts` | Clone → sandbox failure surfaces as `review_verifications` `FAILED` (never gates the review) |
| `review-memory-roundtrip.spec.ts` | `review.report_created` → `MemoryIngestor` → `memory_entries` with `memory_entry_evidence` links |
| `event-log-audit.spec.ts` | Every state change lands in `event_log` with one `correlation_id`; audit queries (Q1–Q9) replay correctly |
| `judge-shadow-independence.spec.ts` | `JudgeShadow` runs on `review.report_created` log-only; failure never mutates the report |
| `load-profile.spec.ts` | 50-task smoke — the tested scaling ceiling (`docs/runbook/limitations.md` §1) |

## Utilities

- `e2e/utils/wait.ts` — `waitForCount(fn, expected, timeout)` polling helper used by async assertions.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Connection refused :5432` | `docker compose up -d` |
| `relation "tasks" does not exist` | `pnpm --filter @harness/db migrate` |
| `Cannot find module '@harness/db/dist/test-utils.js'` | `pnpm build` first — e2e aliases resolve via `dist/` |
| `MCP config file not found` | Expected when `MCP_CONFIG_PATH=/nonexistent` — means empty registry (settings list empty), not an error |
| Spec timeout after 30s | Check Postgres is not under load; e2e is serial by design — don't run `pnpm test` concurrently |

## Related docs

- `docs/runbook/audit-queries.md` — Q1–Q9 exercised by `event-log-audit.spec.ts`
- `docs/retros/phase3-e2e.md` + `docs/architecture/idempotency-audit.md` — idempotency guard inventory
