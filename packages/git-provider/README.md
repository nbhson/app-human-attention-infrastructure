# @harness/git-provider — Git Host Read Seam

The provider seam that reads an external pull request / merge request from a Git
host (GitHub first), so the AI reviewer has a diff to review.

**Status:** review-reorient Phase 3 — `GitHubProvider` complete ·
**Boundary rule:** depends only on `@harness/domain`; never an engine, host SDK, or event-bus.

---

## Purpose

1. **Define the `GitProvider` seam** — fetch PR metadata + per-file diff, and (for
   the later write-back path) post a comment / set a status.
2. **Provide a GitHub implementation** — REST over the built-in `fetch`, no `octokit`.
3. **Map host JSON → domain `PullRequest`** — via a pure, fixture-testable mapper.

```text
   POST /api/reviews { prUrl }
            │
            ▼
   GitProvider.fetchPullRequest({ repo, number })
            │
            ▼
   PullRequest { metadata + files[].patch }  →  AI reviewer
```

---

## Interface

```typescript
interface GitProvider {
  readonly type: GitProviderType;
  fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest>;
  postComment(input: FetchPullRequestInput, body: string): Promise<void>;
  setStatus(input, state: 'pending' | 'success' | 'failure', description): Promise<void>;
}
```

- `FetchPullRequestInput.repo` is the `host/owner/name` slug (e.g. `github.com/acme/api`),
  split by `parseRepoPath` into host-specific API segments.
- Errors are always `GitProviderError` (with optional `status`), never thrown raw.

---

## Modules

| Module | What it provides |
| --- | --- |
| `git-provider.ts` | `GitProvider`, `FetchPullRequestInput`, `GitProviderError`, `parseRepoPath`. |
| `github-provider.ts` | `GitHubProvider` — bearer-token REST; `baseUrl` defaults to `https://api.github.com` for enterprise/self-hosted. |
| `github-mapper.ts` | `mapGithubPullRequest` + the raw GitHub payload subsets, pure and fixtures-testable. |

---

## Test strategy

- The mapper is tested against fixture JSON (`added`/`modified`/`removed`/`renamed`
  → `CREATED`/`MODIFIED`/`DELETED`/`RENAMED`).
- The provider's `fetch` is stubbed in tests; no live token is required (and none
  is committed — same `.env.example` hygiene as the rest of the repo).

---

## Directory structure

```
src/
├── index.ts
├── git-provider.ts
├── github-provider.ts
└── github-mapper.ts
```

## Public API surface

```typescript
// GitProvider, FetchPullRequestInput, GitProviderError, parseRepoPath,
// GitHubProvider, mapGithubPullRequest, GithubPullPayload, GithubPrFilePayload
```

## Dependency rule

```
packages/git-provider → imports only @harness/domain
```

## Planned (later phases)

- `GitLabProvider`, `BitbucketProvider` — same seam, same mapper split.
- Write-back wiring through `apps/api` behind a per-provider toggle.