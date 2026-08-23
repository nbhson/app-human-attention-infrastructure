# Day 01 — Monorepo scaffold, tooling, CI skeleton

| | |
|---|---|
| **Week** | W1 — Foundation |
| **Spec refs** | Spec 1 §5 (modular core), §8 (repository layout) |
| **Estimated effort** | 6h |
| **Prerequisites** | None — greenfield |

---

## 1. Objectives

- Stand up the pnpm workspace + Turborepo monolith with the `apps/*`, `packages/*`, `fixtures/` layout from the phase plan.
- Lock a shared TypeScript (Node 20+, ESM), ESLint, Vitest, and Prettier baseline every later package inherits.
- Create an empty Fastify `apps/api` and a React + Vite `apps/web` that both boot and exit cleanly.
- Add `docker-compose.yml` running PostgreSQL 16 and a GitHub Actions CI skeleton (`lint` → `typecheck` → `test`).
- Reserve the `@harness/*` package names with empty skeleton dirs — real types land from Day 02 onward.

## 2. Design Decisions

- **pnpm workspaces + Turborepo** implement the modular monolith: one repo, many packages, one `turbo run` pipeline for build/test/lint.
- Node 20 + ESM everywhere; a single `tsconfig.base.json` with `strict` and `verbatimModuleSyntax`, and relative imports across package boundaries (no path aliases leaking between packages).
- Fastify is the API from day one (lightweight REST for review + decision); the web is a minimal Vite/React shell — neither gains review features until Week 2.
- No `@harness/domain` types today: the scaffold ships only plumbing so CI can be green without a premature type vocabulary.

## 3. Tasks

### 3.1 Workspace + tooling (90 min)
- [ ] `pnpm-workspace.yaml` listing `apps/*`, `packages/*`, `fixtures/*`
- [ ] Root `package.json` with `turbo` and the `@harness/*` scope reserved
- [ ] `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.editorconfig`, `.nvmrc`

### 3.2 Apps boot (90 min)
- [ ] `apps/api` Fastify server with a `/health` route + `dev`/`build`/`test` scripts
- [ ] `apps/web` Vite React shell with `dev`/`build` scripts

### 3.3 Infra + CI (90 min)
- [ ] `docker-compose.yml` with `postgres:16` + healthcheck
- [ ] `.github/workflows/ci.yml`: install → `turbo lint` → `turbo typecheck` → `turbo test`

### 3.4 Placeholder packages (90 min)
- [ ] Empty `packages/*` skeletons (domain, event-bus, db, di, orchestrator, agent-runtime, git-provider, ticket-provider, context-engine, verification-engine, attention-engine, review) each with a stub `package.json`

## 4. Deliverables

| File | Description |
|------|-------------|
| `pnpm-workspace.yaml` | Workspace globs |
| `turbo.json` | CI task graph |
| `tsconfig.base.json` | Shared TS baseline |
| `eslint.config.mjs` | Shared lint (boundaries stubbed for Day 05) |
| `apps/api/src/server.ts` | Fastify hello world |
| `apps/web/src/main.tsx` | React shell |
| `docker-compose.yml` | PostgreSQL 16 for local dev |
| `.github/workflows/ci.yml` | Lint + typecheck + test |

## 5. Acceptance Criteria

- [ ] `pnpm install && pnpm build` completes cleanly across the empty workspace
- [ ] `docker compose up -d` yields a healthy `postgres:16`
- [ ] `pnpm --filter @harness/api dev` returns 200 on `/health`
- [ ] A clean checkout runs the CI workflow end-to-end without failures

## 6. Notes & Pitfalls

- Keep the tree empty-but-green; resist adding domain types early — they land Day 02 and premature definitions force a re-scaffold.
- Pin Node via `engines`/`.nvmrc` so local and CI never drift on the ESM/TS config.

---

*Next: [Day 02 — @harness/domain — core types, branded IDs, review-report types](day-02.md)*