# @harness/ticket-provider — Ticket System Read Seam

The provider seam that reads a requirement from a ticket system (Jira first), so
the AI reviewer has a spec/requirement to weigh the PR against.

**Status:** review-reorient Phase 3 — `JiraProvider` complete ·
**Boundary rule:** depends only on `@harness/domain`; never an engine, host SDK, or event-bus.

---

## Purpose

1. **Define the `TicketProvider` seam** — fetch issue metadata + description.
2. **Provide a Jira implementation** — Cloud REST over the built-in `fetch`, no SDK.
3. **Map host JSON → domain `Issue`** — flattening Jira's ADF description to
   plain text via a pure, fixture-testable `adfToPlainText`.

```text
   POST /api/reviews { jiraTicket: "ACME-1234" }
            │
            ▼
   TicketProvider.fetchIssue({ key })
            │
            ▼
   Issue { summary, description }  →  AI reviewer's "requirements" input
```

---

## Interface

```typescript
interface TicketProvider {
  readonly type: TicketProviderType;
  fetchIssue(input: FetchIssueInput): Promise<Issue>;
}
```

- `FetchIssueInput.key` is the host issue key (e.g. `ACME-1234`).
- Errors are always `TicketProviderError` (with optional `status`), never thrown raw.

---

## Modules

| Module | What it provides |
| --- | --- |
| `ticket-provider.ts` | `TicketProvider`, `FetchIssueInput`, `TicketProviderError`. |
| `jira-provider.ts` | `JiraProvider` — bearer-token REST against a configurable `baseUrl` (e.g. `https://acme.atlassian.net`). |
| `jira-mapper.ts` | `mapJiraIssue`, `adfToPlainText`, and the raw Jira payload subset. |

---

## Test strategy

- The mapper + `adfToPlainText` are tested against fixture ADF documents
  (nested paragraphs / text nodes), no live token.
- The provider's `fetch` is stubbed; no live credential is required or committed.

---

## Directory structure

```
src/
├── index.ts
├── ticket-provider.ts
├── jira-provider.ts
└── jira-mapper.ts
```

## Public API surface

```typescript
// TicketProvider, FetchIssueInput, TicketProviderError,
// JiraProvider, mapJiraIssue, adfToPlainText, JiraIssuePayload
```

## Dependency rule

```
packages/ticket-provider → imports only @harness/domain
```

## Planned (later phases)

- Write-back: transition an issue (move status) behind a per-provider toggle.