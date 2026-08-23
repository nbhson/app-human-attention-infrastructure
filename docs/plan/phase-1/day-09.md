# Day 09 — TicketProvider seam + JiraProvider (fetch issue)

| | |
|---|---|
| **Week** | W2 — Review ingest core |
| **Spec refs** | Spec 1 §5 (replaceable integrations), §7 (boundary R14) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 08 (`GitProvider` seam pattern) |

---

## 1. Objectives

- Define the read-only `TicketProvider` seam (`fetchIssue`) returning a requirement (project, key, summary, description, status) for any tracker.
- Implement `JiraProvider` against the Jira REST API by token, producing a normalized requirement the reviewer later grounds the diff against.
- Enforce **R14**: `@harness/ticket-provider` imports only `@harness/domain`, and test with recorded fixtures (no live Jira in unit tests).
- Keep the ticket a *requirement source* only — no status updates or write-back (Phase 3).

## 2. Design Decisions

- **Read-first** again: `fetchIssue` is the only operation; there is no comment/transition/write surface. Reviews never mutate the issue tracker.

```ts
export interface TicketProvider {
  readonly kind: TicketProviderType;             // 'JIRA'
  fetchIssue(url: TicketUrl): Promise<Requirement>;
}
export interface Requirement {
  readonly projectKey: string;
  readonly issueKey: string;
  readonly summary: string;
  readonly description: string;
  readonly status: string;
}
```

- `JiraProvider` mirrors the `GitHubProvider` pattern: injected HTTP client + injected token, fixture-replay tests, typed error mapping.
- Additional trackers are Phase 3; the seam isolates ingest from Jira so the requirement feed is swappable.

## 3. Tasks

### 3.1 Domain types (60 min)
- [ ] `TicketUrl` parsing (Jira `PROJECT-123`) + `Requirement` type in `@harness/domain`

### 3.2 Seam + Jira impl (180 min)
- [ ] `packages/ticket-provider/src/ticket-provider.ts` interface
- [ ] `packages/ticket-provider/src/jira/jira-provider.ts` REST fetch + normalization
- [ ] Fixture transport + recorded Jira responses

### 3.3 Boundary + tests (120 min)
- [ ] R14 architecture assertion (imports only `@harness/domain`)
- [ ] Unit tests: key parsing, description flattening, 401/404 mapping to `TicketProviderError`

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/ticket-provider/src/ticket-provider.ts` | `TicketProvider` seam + `Requirement` |
| `packages/ticket-provider/src/jira/jira-provider.ts` | Jira REST implementation |
| `packages/ticket-provider/src/jira/ticket-url.ts` | Ticket key parser |
| `fixtures/jira/issue.json` | Recorded fixture for tests |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/ticket-provider test` passes on fixtures only (no network)
- [ ] A `PROJECT-123` URL yields a normalized `Requirement` with summary + description
- [ ] R14 test confirms the package imports nothing but `@harness/domain`
- [ ] An unauthenticated (401) response surfaces `TicketProviderError`

## 6. Notes & Pitfalls

- Normalize Jira's rich description (ADF) into plain text without depending on the tracker's SDK — the seam must stay host-agnostic.
- The requirement is *input* to the reviewer's prompt; it is not a verdict and carries no write-back.

---

*Next: [Day 10 — LLMProvider seam + OpenAICompatibleProvider + MockLLM](day-10.md)*