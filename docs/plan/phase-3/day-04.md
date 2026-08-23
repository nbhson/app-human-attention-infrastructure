# Day 04 — Harden `JiraProvider`: Comments + Transition Beside Fetch

| | |
|---|---|
| **Week** | 1 — Provider breadth |
| **Spec refs** | ticket-provider §2 (TicketProvider seam), §4 (modules); Architecture §7 (boundary rule) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 03 (registry + `provider_configs`); `JiraProvider.fetchIssue` ships |

---

## 1. Objectives

By end of day you will have:

1. `JiraProvider` extended beyond `fetchIssue` with `postComment(issueKey, body)` and `transition(issueKey, toState)` — read + two external-write primitives, still *commentary/status*, never a code change.
2. A `TicketProvider` seam extended accordingly, kept backward-compatible where GitHub-only callers didn't use it.
3. ADF body construction for comments (the inverse of `adfToPlainText`: `plainTextToAdf`), fixture-tested.
4. Transitions resolved by **name** (human-readable) against the Jira `/transitions` catalog, not by internal id.

This completes the ticket-provider side of provider breadth before the Day 05 checkpoint.

---

## 2. Design Decisions

### 2.1 Write primitives are commentary, not code

Jira comments and issue transitions are exactly the "commentary/status" class of external write the Phase-3 README sanctions. `transition()` moves a ticket to a status the human has configured (e.g. "In Review"); it never modifies a repository, never authors code. Document this in the interface JSDoc so the invariant is stated at the seam.

### 2.2 Extended seam

```typescript
// packages/ticket-provider/src/ticket-provider.ts
export interface TicketProvider {
  readonly type: TicketProviderType;
  fetchIssue(input: FetchIssueInput): Promise<Issue>;
  postComment(input: FetchIssueInput, body: string): Promise<void>;
  transition(input: FetchIssueInput, toState: string): Promise<void>;  // toState = human-readable status name
}
```

### 2.3 Comment = ADF document (inverse of fetch's flatten)

Fetch *flattens* ADF → text (`adfToPlainText`); write *constructs* ADF from text (`plainTextToAdf`) so the comment renders with paragraphs/lists. Round-trip test: `adfToPlainText(plainTextToAdf(x)) === x` for canonical inputs.

### 2.4 Transition by name, resolved at call time

`POST /rest/api/3/issue/{key}/transitions` requires a transition **id**; humans think in **names**. `transition()` calls `GET /rest/api/3/issue/{key}/transitions` first, matches `toState` against `transitions[].name`, and 404s with a clear error listing available names when there's no match. Failures return `TicketProviderError`.

---

## 3. Tasks

### 3.1 Seam extension (30 min)

- [ ] Extend `TicketProvider` (§2.2); add JSDoc "commentary/status, never code" note.
- [ ] Backward-compat: callers that only `fetchIssue` are unaffected (methods additive).

### 3.2 `postComment` + ADF builder (75 min)

- [ ] `POST /rest/api/3/issue/{key}/comment` with ADF body from `plainTextToAdf(body)`.
- [ ] `plainTextToAdf` — paragraphs + list rendering; round-trip fixture tests.

### 3.3 `transition` by name (75 min)

- [ ] `GET transitions` catalog → match name → `POST transition`.
- [ ] No-match → `TicketProviderError` listing available names; 401/404 wrapping.

### 3.4 Mapping + payload types (45 min)

- [ ] `JiraCommentPayload`, `JiraTransitionsPayload` subsets; keep mapper pure.

### 3.5 Tests (60 min)

- [ ] Round-trip ADF; comment payload shape; transition name-match + no-match.
- [ ] Stubbed-fetch error wrapping.
- [ ] Boundary grep: only `@harness/domain` imports.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/ticket-provider/src/ticket-provider.ts` (updated) | `postComment`/`transition` on the seam |
| `packages/ticket-provider/src/jira-provider.ts` (updated) | Comment + transition impl |
| `packages/ticket-provider/src/jira-mapper.ts` (updated) | `plainTextToAdf` + payload types |
| `packages/ticket-provider/src/__tests__/jira-writeback.test.ts` | Comment/transition tests |
| `packages/ticket-provider/README.md` (updated) | Status + new modules |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/ticket-provider test` — green, fixtures only.
- [ ] `postComment` posts an ADF document that round-trips through `adfToPlainText`.
- [ ] `transition("In Review")` resolves the name → id and posts; unknown name returns an error listing available names.
- [ ] 401/404 → `TicketProviderError` with correct status.
- [ ] JSDoc/comments state the commentary/status boundary (never code).
- [ ] `grep -r "from '@harness" packages/ticket-provider/src` shows only `@harness/domain`.

---

## 6. Notes & Pitfalls

- **Transition names are tenant-specific.** "In Review" may not exist in a given Jira workflow — always resolve from the `/transitions` catalog at call time, never cache or hard-code ids.
- **ADF is a tree, not markdown.** The inverse builder must handle paragraph vs list vs inline; a naive `text → paragraph` only builder will render long comments as one blob. Keep it minimal but structured.
- **Comments/transitions are the write-back primitives** that Day 07 will wrap under `WriteBackService` — do not yet add idempotency or audit; the seam just exposes the capability.
- **Tomorrow (Day 05):** Week 1 checkpoint — fetch PR/MR from all three providers + Jira end-to-end.

---

*Next: [Day 05 — Week 1 Checkpoint: Fetch PR/MR from All Three Providers + Jira](day-05.md)*