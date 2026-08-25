# Contributing

Thanks for contributing. The short version: **fork, keep it green, open a PR, and
never commit a secret.** The long version is below.

## Setup

Clone-to-green in ~15 minutes — follow [`docs/dev-guide.md`](docs/dev-guide.md).
Summary:

```sh
pnpm install                     # links the @harness/* workspace packages
docker compose up -d             # Postgres :5432 (the only docker service)
cp .env.example .env             # placeholders only — no real keys
pnpm --filter @harness/db migrate
pnpm build                       # workspace deps resolve to built dist/
```

## The green gate

A PR is ready when this passes locally:

```sh
pnpm lint
pnpm typecheck
pnpm test       # ~975 unit + integration tests
pnpm e2e        # 9 end-to-end tests (needs Postgres)
```

Or one shot: `pnpm test && pnpm lint && pnpm e2e`. CI runs the same, plus a
per-package test matrix (`.github/workflows/ci.yml`).

## Where to change what

- **Run the product** through `apps/api` + `apps/web`; a review enters through
  `apps/api/src/routes/reviews.ts`.
- **Engines & libraries** live in `packages/*`. Each package's `README.md` states
  its invariants and boundary rules; engines never import another engine.
- **Docs** — honest post-mortems are `docs/retros/`; the architecture spec + notes
  are `docs/architecture/`, and one README per package.

## Commits

One concern per commit, imperative subject, scoped:

```
feat(mcp): Day N — one-line summary of the change
```

The history follows a day-per-commit cadence; keep a commit's subject honest and
small. Co-authored commits are welcome.

## Pull requests

- Fork → branch → change → green gate → PR against `main`.
- Link the day / doc / issue the PR addresses.
- Keep the scope reviewable: one concern, not a grab-bag.
- For a behavior change, add or update the test that would have caught the old
  behavior.

## Secrets hygiene (non-negotiable)

- **Never commit a live API key, token, or credential.** `.env` is gitignored;
  `.env.example` carries placeholders only.
- The real provider paths are compile-tested only; CI uses throwaway credentials
  against an ephemeral Postgres.
- If you *think* you might have committed a secret, treat it as compromised: rotate
  it, and open a [private report](SECURITY.md) rather than a public issue.

## Code of conduct

All participation follows the [Contributor Covenant](CODE_OF_CONDUCT.md).