# @harness/writeback — Commentary/Status Write-Back Seam

Posts the outcome of a review decision back to the external PR/ticket
(comment / status / label on a Git host; comment / transition on Jira), through
the Week-1 MCP transport — never a second channel, never a code change.

**Status:** complete (as-built) ·
**Boundary rule:** a seam, not an engine — imports only `@harness/domain`,
`@harness/mcp`, `@harness/git-provider`, `@harness/ticket-provider`; every write
rides an MCP tool call, never a host SDK.

---

## Purpose

1. **Define the `WriteBackService` seam** — a single `write(intent)` that turns a
   `WriteBackIntent` into a `WriteBackResult`.
2. **Express only commentary/status** — `COMMENT | STATUS | LABEL | TRANSITION`
   (`WritebackAction`). The intent carries no `code`, `commit`, or `diff` slot;
   adding one is a visible, reviewable type change.
3. **Ride the MCP transport** — the same `McpServerRegistry` + `GitToolMap` /
   `TicketToolMap` the read path uses, so read and write share one channel.
4. **Audit + idempotency** — claim-then-write against a `WritebackLogStore`; a retry
   of an already-succeeded write is a `DUPLICATE`, never a double post.
5. **Redact secrets** — a caught tool error is scrubbed before it lands in the
   audit log.

## The toggle (fail-safe, on by default)

Write-back is **ON by default** and can be opted out at any of three layers — the
human's request, the operator's ceiling, or the per-host check:

```
   request `writeback: true`
        ∧  WRITEBACK_ENABLED  ≠ 0|false    (global env ceiling, unset ⇒ ON)
        ∧  WRITEBACK_<PROVIDER> ≠ 0|false  (per-host env check inside MCPWriteBack, unset ⇒ ON)
```

Any layer opting out → `write()` resolves to a successful no-op with **no** audit
row and **nothing** external. To re-arm the historical off-at-rest behavior, set
`WRITEBACK_ENABLED=0` (and/or `WRITEBACK_<PROVIDER>=0`).

## The write path

```text
   POST /api/reviews/:id/decision  (human APPROVE / REJECT)
            │
            ▼
   WriteBackService.write(intent)
            │  enabled(provider)?   ── no ──▶ ok, no row, nothing external
            ▼
   validate(intent)  ── invalid ──▶ throw WriteBackError (programming error)
            ▼
   store.claim(intent)  ── duplicate ──▶ DUPLICATE row, no second call
            ▼
   registry.get(host) → tool-map.resolve → callTool(...)
            │
            ├── ok    ──▶ SUCCEEDED row (+ externalRef)
            └── error ──▶ FAILED row (error redacted)
```

## Modules

| Module | What it provides |
| --- | --- |
| `writeback-service.ts` | `WriteBackService` + `WriteBackError` (carries `provider`/`action`/`externalId`/`status`). |
| `mcp-writeback.ts` | `MCPWriteBack` — the MCP-backed implementation, plus `MCPWriteBackOptions` (injected `enabled`). |
| `dedup.ts` | `dedupKey` (sha256 of `provider\|externalId\|action\|normalized body`), `normalizeBody`, `effectiveBody`. |
| `redact.ts` | `redactSensitive` + `credentialEnvValues` — scrub tokens/keys from the audit `error`. |

## Audit (`writeback_log`)

One append-only row per attempt, in the order written:

| Status | Meaning |
| --- | --- |
| `PENDING` | claimed before the tool call. |
| `SUCCEEDED` | the tool call returned `ok`; `external_ref` carries the host handle. |
| `FAILED` | transport/host failure; `error` is redacted. |
| `DUPLICATE` | an identical write had already succeeded — skipped, no external call. |

A unique partial index on `dedup_key WHERE status IN ('PENDING','SUCCEEDED')` enforces
one *in-flight* write per intent; a `FAILED` row still lets a retry append a fresh
`PENDING` row and try again.

## Test strategy

- Unit tests drive `MCPWriteBack` with a scripted in-memory `McpServerRegistry` and
  a fake `WritebackLogStore` — no host, no token, no network.
- Idempotency: racing identical intents are asserted to yield one `SUCCEEDED` +
  one `DUPLICATE`, never two external calls.
- Redaction: a thrown error embedding a `Bearer`/`ghp_`/`token=` string is asserted
  to store the masked form.

## Directory structure

```
src/
├── index.ts
├── writeback-service.ts
├── mcp-writeback.ts
├── dedup.ts
└── redact.ts
```

## Public API surface

```typescript
// WriteBackService, WriteBackError, MCPWriteBack, MCPWriteBackOptions,
// dedupKey, normalizeBody, effectiveBody, redactSensitive, credentialEnvValues
```

## Dependency rule

```
packages/writeback → @harness/domain, @harness/mcp, @harness/git-provider, @harness/ticket-provider
                 → never a host SDK, never @harness/db (the audit store is injected)
```

Write-back never imports a host REST adapter — `GitHubProvider` / `JiraProvider` are
the direct read path; write-back reaches hosts only through `@harness/mcp`
(`McpServerRegistry`).