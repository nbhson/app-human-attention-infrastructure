# Day 1 — Monorepo Scaffold, Tooling, CI Skeleton

**Week:** 1 — Foundation
**Spec refs:** Architecture doc §11 (Modular Monolith), §12 (tech choices)
**Estimated effort:** 6–8h

> ✅ **Status:** verified against the working tree on 2026-08-20. Scaffold is complete; `pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck` all pass. Divergences from the original plan are listed in §7.

---

## 1. Objectives

Establish the repository skeleton that every subsequent day builds on. By end of day, `pnpm install && pnpm build && pnpm test` works across an empty-but-wired monorepo, and a developer can add a new package in under 5 minutes.

## 2. Why This Comes First

Every subsystem spec (docs 2–7) assumes a modular monolith with enforced package boundaries. Getting the scaffold right on Day 1 prevents the "we'll fix the build later" debt that kills week 3–4 velocity. The layout created today mirrors the target layout in `docs/plan/README.md` §3 exactly.

## 3. Tasks

### 3.1 Root scaffold (90 min)
- [x] `pnpm init` at repo root; set `"packageManager": "pnpm@9.x"` and `"engines": { "node": ">=20" }`.
- [x] `pnpm-workspace.yaml` with `apps/*`, `packages/*`, `fixtures/*`.
- [x] Root `package.json` scripts: `build`, `test`, `lint`, `typecheck`, `dev` (turbo pipeline passthrough).
- [ ] `turbo.json` pipelines: `build` (depends on `^build`), `test`, `lint`, `typecheck`, with caching enabled. — *Partially done: `build`, `typecheck`, `dev` exist, but `test` and `lint` are NOT turbo tasks (root scripts call `vitest run` / `eslint .` directly).*
- [x] `.gitignore` (node_modules, dist, .turbo, coverage, .env), `.nvmrc` (`20`), `.editorconfig`.

### 3.2 TypeScript base config (45 min)
- [x] `tsconfig.base.json` at root: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `module: NodeNext`, `target: ES2022`.
- [x] Each future package will extend this; create `packages/domain/tsconfig.json` as the reference example.
- [ ] Enable project references so cross-package imports typecheck fast. — *Not done: packages use a simple `extends` + `include`; no `references`/`composite`. Not yet needed (no cross-package imports).*

### 3.3 Empty package skeletons (60 min)
Create all target packages with just `package.json` + `tsconfig.json` + `src/index.ts` (exporting a placeholder constant):
`domain`, `event-bus`, `db`, `orchestrator`, `agent-runtime`, `context-engine`, `artifact-tracker`, `attention-engine`, `verification-engine`, `review`.
Plus `apps/api` (Fastify hello-world) and `apps/web` (Vite React, default template, port 5173).
- Naming convention: `@harness/<name>`. All internal deps use `workspace:*`.
- [x] All 10 packages + `apps/api` + `apps/web` scaffolded with `package.json` + `tsconfig.json` + `src/index.ts`. — *Note: an extra `packages/di/` exists but contains only a `README.md` spec placeholder (for Day 05), not a scaffolded package. `apps/api` serves `GET /health` (Fastify 5, port 3000) rather than a literal hello-world. No internal `workspace:*` deps are used yet (all packages are standalone).*

### 3.4 Testing + lint tooling (60 min)
- [x] Vitest at root with a shared `vitest.config.ts`; one smoke test per package (`expect(true).toBe(true)`) to prove wiring.
- [x] ESLint flat config (`eslint.config.mjs`): typescript-eslint recommended, `no-floating-promises: error`, import ordering. — *Partially done: recommended + `no-floating-promises: error` present, but no import-ordering rule was added.*
- [x] Prettier config + `lint-staged` + `simple-git-hooks` pre-commit (`pnpm lint-staged`).

### 3.5 Docker Compose + env (45 min)
- [x] `docker-compose.yml`: postgres:16-alpine, port 5432, volume `pgdata`, healthcheck.
- [x] `.env.example`: `DATABASE_URL=postgres://harness:harness@localhost:5432/harness`.
- [x] Verify: `docker compose up -d` → `pg_isready` passes.

### 3.6 CI skeleton (45 min)
- [x] `.github/workflows/ci.yml`: on PR → install, lint, typecheck, build, test (with postgres service container).
- [x] Even if CI isn't fully used in 30 days, having it green from Day 1 keeps the main branch honest.

## 4. Deliverables

- Fully scaffolded monorepo; all 10 packages + 2 apps exist and build.
- `docker compose up -d && pnpm install && pnpm build && pnpm test` exits 0 from a clean clone.

## 5. Acceptance Criteria

- [x] `pnpm build` compiles all packages with zero errors/warnings. *(12/12 tasks successful)*
- [x] `pnpm test` runs ≥ 12 smoke tests (one per package/app) successfully. *(12 files, 12 tests passed)*
- [x] `pnpm lint` and `pnpm typecheck` pass. *(both exit clean)*
- [x] Postgres reachable via `DATABASE_URL` from `.env.example`.
- [x] CI workflow file present and syntactically valid (`actionlint` or GH UI check).

## 6. Notes & Pitfalls

- Don't install Drizzle/Fastify/etc. today — just the build wiring. Dependencies arrive with the day that needs them (keeps reviews small). *(Exception: Fastify was installed for `apps/api`'s `/health` endpoint.)*
- If Turborepo config fights you, fall back to `pnpm -r` scripts and revisit on Day 5 — don't burn more than 30 minutes.
- Commit convention from today: `feat(scope): ...`, scopes = package names.

## 7. Status vs Plan (scanned 2026-08-20)

1. **`turbo.json` gaps** — `test` and `lint` are not turbo tasks; the root `package.json` calls `vitest run` and `eslint .` directly. `build`, `typecheck`, `dev` are wired through turbo. Functional, but not the pipeline described in §3.1.
2. **No project references** — §§3.2's "enable project references" is deferred. Packages extend `tsconfig.base.json` plainly; this is fine until cross-package imports begin.
3. **No import-ordering ESLint rule** — the flat config has recommended + `no-floating-promises`, but the import-ordering rule from §3.4 is missing.
4. **Extra `packages/di/`** — a README-only spec placeholder (Dependency Injection container, planned for Day 05). It is not a scaffolded package and was not in the Day 1 package list.
5. **`apps/api` shape** — serves `GET /health` on port 3000 via Fastify 5, rather than a literal "hello-world" route.