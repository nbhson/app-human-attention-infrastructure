# Day 1 — Monorepo Scaffold, Tooling, CI Skeleton

**Week:** 1 — Foundation
**Spec refs:** Architecture doc §11 (Modular Monolith), §12 (tech choices)
**Estimated effort:** 6–8h

---

## 1. Objectives

Establish the repository skeleton that every subsequent day builds on. By end of day, `pnpm install && pnpm build && pnpm test` works across an empty-but-wired monorepo, and a developer can add a new package in under 5 minutes.

## 2. Why This Comes First

Every subsystem spec (docs 2–7) assumes a modular monolith with enforced package boundaries. Getting the scaffold right on Day 1 prevents the "we'll fix the build later" debt that kills week 3–4 velocity. The layout created today mirrors the target layout in `docs/plan/README.md` §3 exactly.

## 3. Tasks

### 3.1 Root scaffold (90 min)
- [ ] `pnpm init` at repo root; set `"packageManager": "pnpm@9.x"` and `"engines": { "node": ">=20" }`.
- [ ] `pnpm-workspace.yaml` with `apps/*`, `packages/*`, `fixtures/*`.
- [ ] Root `package.json` scripts: `build`, `test`, `lint`, `typecheck`, `dev` (turbo pipeline passthrough).
- [ ] `turbo.json` pipelines: `build` (depends on `^build`), `test`, `lint`, `typecheck`, with caching enabled.
- [ ] `.gitignore` (node_modules, dist, .turbo, coverage, .env), `.nvmrc` (`20`), `.editorconfig`.

### 3.2 TypeScript base config (45 min)
- [ ] `tsconfig.base.json` at root: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `module: NodeNext`, `target: ES2022`.
- [ ] Each future package will extend this; create `packages/domain/tsconfig.json` as the reference example.
- [ ] Enable project references so cross-package imports typecheck fast.

### 3.3 Empty package skeletons (60 min)
Create all target packages with just `package.json` + `tsconfig.json` + `src/index.ts` (exporting a placeholder constant):
`domain`, `event-bus`, `db`, `orchestrator`, `agent-runtime`, `context-engine`, `artifact-tracker`, `attention-engine`, `verification-engine`, `review`.
Plus `apps/api` (Fastify hello-world) and `apps/web` (Vite React, default template, port 5173).
- Naming convention: `@harness/<name>`. All internal deps use `workspace:*`.

### 3.4 Testing + lint tooling (60 min)
- [ ] Vitest at root with a shared `vitest.config.ts`; one smoke test per package (`expect(true).toBe(true)`) to prove wiring.
- [ ] ESLint flat config (`eslint.config.mjs`): typescript-eslint recommended, `no-floating-promises: error`, import ordering.
- [ ] Prettier config + `lint-staged` + `simple-git-hooks` pre-commit (`pnpm lint-staged`).

### 3.5 Docker Compose + env (45 min)
- [ ] `docker-compose.yml`: postgres:16-alpine, port 5432, volume `pgdata`, healthcheck.
- [ ] `.env.example`: `DATABASE_URL=postgres://harness:harness@localhost:5432/harness`.
- [ ] Verify: `docker compose up -d` → `pg_isready` passes.

### 3.6 CI skeleton (45 min)
- [ ] `.github/workflows/ci.yml`: on PR → install, lint, typecheck, build, test (with postgres service container).
- [ ] Even if CI isn't fully used in 30 days, having it green from Day 1 keeps the main branch honest.

## 4. Deliverables

- Fully scaffolded monorepo; all 10 packages + 2 apps exist and build.
- `docker compose up -d && pnpm install && pnpm build && pnpm test` exits 0 from a clean clone.

## 5. Acceptance Criteria

- [ ] `pnpm build` compiles all packages with zero errors/warnings.
- [ ] `pnpm test` runs ≥ 12 smoke tests (one per package/app) successfully.
- [ ] `pnpm lint` and `pnpm typecheck` pass.
- [ ] Postgres reachable via `DATABASE_URL` from `.env.example`.
- [ ] CI workflow file present and syntactically valid (`actionlint` or GH UI check).

## 6. Notes & Pitfalls

- Don't install Drizzle/Fastify/etc. today — just the build wiring. Dependencies arrive with the day that needs them (keeps reviews small).
- If Turborepo config fights you, fall back to `pnpm -r` scripts and revisit on Day 5 — don't burn more than 30 minutes.
- Commit convention from today: `feat(scope): ...`, scopes = package names.
