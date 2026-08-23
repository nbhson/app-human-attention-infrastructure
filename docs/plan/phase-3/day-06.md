# Day 06 — `WriteBackService` Interface + GitHub Comment/Status Impl

| | |
|---|---|
| **Week** | 2 — Write-back |
| **Spec refs** | git-provider §2 (comment/status primitives); Phase-3 README §3 (write-back anchor), §4 |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 05 (W1 checkpoint); `GitProvider` seam has `postComment`/`setStatus` (or gains them here) |

---

## 1. Objectives

By end of day you will have:

1. A `WriteBackService` seam — the single entry point for **commentary/status write-back** (PR comment/label/status, Jira comment/transition), explicitly *never code, never a commit*.
2. A `GitHubWriteBack` adapter behind it: comment + commit-status (`pending`/`success`/`failure`) via the existing `GitProvider` REST primitives.
3. A domain contract `WriteBackIntent` (`COMMENT` | `STATUS` | `LABEL`) carrying an `externalId`, `provider`, `body`, and no code payload.
4. A decision-time call site (stub behind toggle) proving the seam is reachable from the review-decision path.

The day establishes the **write-back seam + one provider**; Day 07 adds GitLab/Bitbucket/Jira, Day 08 adds the audit log + idempotency.

---

## 2. Design Decisions

### 2.1 Write-back is commentary, codified in the type

The intent type cannot express a code change — it only carries a comment body, a status, or a label name. The AI reviewer stays read-only by construction:

```typescript
// packages/domain/src/writeback.ts
export type WriteBackAction = 'COMMENT' | 'STATUS' | 'LABEL';

export interface WriteBackIntent {
  id:         string;
  provider:   GitProviderType;      // 'github' | 'gitlab' | 'bitbucket'
  externalId: string;               // PR/MR number or ticket key
  action:     WriteBackAction;
  body?:      string;               // comment text / status description
  state?:     'pending' | 'success' | 'failure';
  label?:     string;
}
```

### 2.2 Service is a seam, adapters are host-shaped

```typescript
export interface WriteBackService {
  write(intent: WriteBackIntent): Promise<WriteBackResult>;   // { ok, externalRef }
}
```

`GitHubWriteBack` maps intents to `postComment` / `setStatus` / `addLabel` on `GitHubProvider`. The service resolves *which* adapter from `intent.provider`, so new hosts drop in without touching the decision path.

### 2.3 Where it belongs

Small enough for a dedicated `@harness/writeback` package (imports `@harness/domain` + `@harness/git-provider` + `@harness/ticket-provider` only) — or, on day of build, a module in `apps/api`. Chosen: **`@harness/writeback`** to keep the api thin and test it in isolation.

### 2.4 Toggle OFF = no adapter called

The service is constructed with an `enabled(provider): boolean` guard from config. Today the guard exists but is hard-wired to a `WRITEBACK_*` env check per provider — Day 09 promotes it to the per-review decision toggle.

---

## 3. Tasks

### 3.1 Domain contract (30 min)

- [ ] `packages/domain/src/writeback.ts` — `WriteBackAction`, `WriteBackIntent`, `WriteBackResult`.

### 3.2 Scaffold `@harness/writeback` (30 min)

- [ ] `packages/writeback/package.json` (`@harness/writeback`); deps `@harness/domain`, `@harness/git-provider`, `@harness/ticket-provider`.
- [ ] `tsconfig.json` + `src/index.ts` + boundary config entry.

### 3.3 `WriteBackService` + GitHub adapter (120 min)

- [ ] `src/writeback-service.ts` — `write()` dispatch by provider + `enabled` guard.
- [ ] `src/github-writeback.ts` — COMMENT → `postComment`, STATUS → `setStatus`, LABEL → `addLabel`.

### 3.4 Git provider primitives (60 min, if absent)

- [ ] Confirm/add `postComment`, `setStatus`, `addLabel` on `GitHubProvider` (comment/status/label REST endpoints).

### 3.5 Decision-path stub (60 min)

- [ ] In the review-decision handler, accept a `writeback` flag; when on, build a `COMMENT` intent and call `WriteBackService.write` — stubbed behind the env toggle.

### 3.6 Tests (60 min)

- [ ] Intent type: cannot carry code (compile-time). `COMMENT`/`STATUS`/`LABEL` map to the right REST calls (stubbed fetch).
- [ ] `enabled=false` → no adapter called (spy).
- [ ] Boundary grep: only domain + provider packages.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/domain/src/writeback.ts` | `WriteBackIntent`/`Service` contract |
| `packages/writeback/package.json` + `src/index.ts` | New `@harness/writeback` package |
| `packages/writeback/src/writeback-service.ts` | Provider-dispatch service + enabled guard |
| `packages/writeback/src/github-writeback.ts` | GitHub comment/status/label adapter |
| `apps/api/src/routes/reviews.ts` (updated) | Decision-time write-back stub behind toggle |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/writeback test` — green.
- [ ] `WriteBackIntent` has no code/commit/diff field (type-level).
- [ ] COMMENT/STATUS/LABEL intents hit the right GitHub REST calls (stubbed).
- [ ] `enabled=false` for a provider → zero external calls (spy proves).
- [ ] Boundary: `@harness/writeback` imports only `domain` + `git-provider` + `ticket-provider`.
- [ ] `pnpm lint` clean.

---

## 6. Notes & Pitfalls

- **The intent type is the guardrail.** If a future "write code" feature wants a slot, it can't add one to `WriteBackIntent` without visible, reviewable change — that's deliberate.
- **Status vs label vs comment are three different GitHub endpoints.** Don't overload `postComment` — keep one method per action so idempotency (Day 08) has a stable per-action key.
- **`externalId` disambiguates host.** A `number` is meaningless across hosts — carry provider + repo + number.
- **Day 07** adds GitLab/Bitbucket (same three actions over their comment/status endpoints) + Jira comment/transition.

---

*Next: [Day 07 — Write-back for GitLab/Bitbucket + Jira Transition](day-07.md)*