# Day 05 — Module boundaries + DI + dependency enforcement

| | |
|---|---|
| **Week** | W1 — Foundation |
| **Spec refs** | Spec 1 §5 (modular core), §7 (engine boundary rule, R13/R14) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 04 (packages exist + `@harness/db`) |

---

## 1. Objectives

- Build the hand-rolled DI container (`@harness/di`) — a registry keyed by string `TOKENS` with singleton/transient factory registration.
- Wire the shared packages (`domain`, `event-bus`, `db`, `di`) as the inward foundation that no engine may be imported by another.
- Enforce the dependency rule with ESLint `no-restricted-imports` **and** an `architecture.test.ts` that walks the import graph and fails on any violation.
- Codify boundary rules **R13** (`git-provider` imports only `@harness/domain`) and **R14** (`ticket-provider` imports only `@harness/domain`).

## 2. Design Decisions

- **Engines integrate via events + DI, never direct imports.** An engine may import only `domain`, `event-bus`, `db`, `di`; engines never import each other. The full object graph is assembled once in `apps/api/src/bootstrap.ts`.
- Two enforcement layers: a build-time lint rule (fast feedback) and a runtime import-graph test (authoritative, CI-gating) — so a bad import can't slip past a lint config drift.
- DI tokens are string constants in a single `TOKENS` object so every registration/resolution site shares one name (no magic-string drift).

## 3. Tasks

### 3.1 DI container (120 min)
- [ ] `packages/di/src/container.ts` — `register`, `resolve`, scopes, factory overrides
- [ ] `packages/di/src/tokens.ts` — `TOKENS.*` string constants
- [ ] Tests for resolution, singleton lifetime, override, and missing-token errors

### 3.2 Boundary enforcement (120 min)
- [ ] ESLint `no-restricted-imports` banning engine→engine and provider→non-domain imports
- [ ] `architecture.test.ts` import-graph crawl asserting the inward-only + R13/R14 rules

### 3.3 Bootstrap sketch (120 min)
- [ ] `apps/api/src/bootstrap.ts` assembling domain/event-bus/db/di into a container (stub engines resolved lazily)
- [ ] Verify `pnpm build` compiles with boundaries intact

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/di/src/container.ts` | Hand-rolled DI container |
| `packages/di/src/tokens.ts` | Central `TOKENS` |
| `eslint.config.mjs` | Boundary import rules (R13/R14 + engine isolation) |
| `apps/api/src/bootstrap.ts` | Single composition root |
| `apps/api/test/architecture.test.ts` | Import-graph boundary test |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/di test` passes
- [ ] `pnpm exec turbo lint` flags a planted engine→engine import
- [ ] `architecture.test.ts` fails when `git-provider` or `ticket-provider` imports `@harness/db`
- [ ] `apps/api` boots a container resolving `IEventBus`, DB client, and `TaskService`

## 6. Notes & Pitfalls

- The import-graph test is the enforcement of record — keep it static (parse + walk `import` statements), not a runtime that needs a DB.
- Provider seams (Day 08/09) must stay at exactly one dependency (`@harness/domain`); the R13/R14 tests make that non-negotiable from here on.

---

*Next: [Day 06 — Canonical Task state machine (13 states)](day-06.md)*