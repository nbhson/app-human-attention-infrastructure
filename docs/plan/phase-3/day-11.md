# Day 11 — Clone PR into Sandbox Worktree (`GitProvider.cloneAndCheckout`)

| | |
|---|---|
| **Week** | 3 — Verification breadth |
| **Spec refs** | Spec 7 §5.5 (sandbox isolation); git-provider §2; verification-engine execution model |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 10 (W2 checkpoint); Phase-2 `@harness/sandbox` exists; three `GitProvider` impls fetch PRs |

---

## 1. Objectives

By end of day you will have:

1. `GitProvider.cloneAndCheckout(input, workdir)` — clone the PR/MR's repo into a sandbox worktree and check out the **head commit** the PR proposes (source branch/tip), on a dedicated throwaway branch — never `main`.
2. The clone paths stored in the provider-neutral shape verification will consume (`CloneResult { workdir, headSha, sourceBranch, targetBranch }`).
3. Shallow clone + sparse options to keep the sandbox cheap; bounded depth/timeout.
4. Stubbed-git tests proving the right clone/checkout command sequence per provider (they differ mainly in ref resolution, not the checkout).

This is the *ingest half* of verification breadth; Days 12–13 run tests and publish evidence.

---

## 2. Design Decisions

### 2.1 Verification clones the PR's OWN code — the harness authors nothing

The substrate is the external repository state at the PR's head. The harness clones + checks out to *read and run* the PR's own build/test — it never patches, never "fixes", never writes a commit. This is the concrete realization of "read-only reviewer".

### 2.2 Provider-neutral clone seam

```typescript
interface GitProvider {
  // ...existing...
  cloneAndCheckout(input: CloneInput, workdir: string): Promise<CloneResult>;
}
interface CloneResult { workdir: string; headSha: string; sourceBranch: string; targetBranch: string; }
```

Git (the tool) is the same across hosts; what differs is **resolving the head SHA** (GitHub `head.sha`, GitLab `sha` from MR, Bitbucket `source.commit.hash`). Each provider resolves its SHA then shells a shallow `git clone` + `git checkout <sha>`.

### 2.3 Shallow + depth-bounded; never the whole history

`git clone --depth 1 --no-tags` then fetch the specific `headSha` if not on the tip. This bounds time and disk; full history is irrelevant to "did the PR's change break its own tests".

### 2.4 Read-only + timeout

Clone and checkout run under a wall-clock timeout and land in the `@harness/sandbox` worktree; failures surface as `GitProviderError` (or a dedicated `CloneError`), never partial-silence.

---

## 3. Tasks

### 3.1 Seam extension (30 min)

- [ ] Add `cloneAndCheckout` + `CloneInput`/`CloneResult` to `GitProvider`.

### 3.2 SHA resolution per provider (90 min)

- [ ] GitHub/GitLab/Bitbucket resolve head SHA from the already-fetched `PullRequest`; add a helper `resolveHeadSha(pullRequest)`.

### 3.3 Clone executor (90 min)

- [ ] `packages/git-provider/src/clone.ts` — shallow clone → checkout SHA → return `CloneResult`; timeout + error wrapping.

### 3.4 Sandbox worktree wiring (45 min)

- [ ] Emit clone into a fresh workdir under `@harness/sandbox`'s ephemeral root; clean-up hook.

### 3.5 Tests (75 min)

- [ ] Stubbed git: correct shallow clone + checkout sequence; SHA resolution per provider fixture; timeout → error; no `main` checkout ever.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/git-provider/src/git-provider.ts` (updated) | `cloneAndCheckout` seam |
| `packages/git-provider/src/clone.ts` | Shallow clone + checkout executor |
| `packages/git-provider/src/head-sha.ts` | `resolveHeadSha` per provider |
| `packages/git-provider/src/__tests__/clone.test.ts` | Clone + SHA resolution tests |

---

## 5. Acceptance Criteria

- [ ] `cloneAndCheckout` produces a worktree at the PR head SHA on a throwaway ref (never `main`).
- [ ] Shallow clone (`--depth 1`) with timeout; no full history fetched.
- [ ] Head-SHA resolution correct for all three providers from fixtures.
- [ ] Failure returns `CloneError`/`GitProviderError` with the reason.
- [ ] `grep -r "from '@harness" packages/git-provider/src` shows only `@harness/domain`.

---

## 6. Notes & Pitfalls

- **Merge commits are the trap.** A PR may be behind its target; checkout the *head SHA* (the merge candidate) explicitly rather than trusting `source_branch` ref, or you can test the wrong commit.
- **Don't checkout `main`.** The whole point is testing the candidate change, not the base. `main` checkout is a correctness bug, not a style nit — test for it.
- **Shallow clone then SHA-fetch.** `--depth 1` may not contain the SHA if the PR head isn't the default branch tip; be ready to `git fetch origin <sha>` once.
- **Day 12** runs build/test in the Docker sandbox against this clone.

---

*Next: [Day 12 — Run Build/Test in Docker Sandbox Against the Clone](day-12.md)*