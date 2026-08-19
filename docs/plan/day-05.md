# Day 05 — Module Boundaries, DI & Dependency Enforcement

| | |
|---|---|
| **Week** | 1 — Foundation |
| **Spec refs** | Spec 1 §4 (Subsystem Map), Spec 1 §5 (Dependency Rules) |
| **Estimated effort** | 5–6 hours |
| **Prerequisites** | Day 04 (db package, event log writer) |

---

## 1. Objectives

By end of day you will have:

1. A **dependency injection container** (`packages/di`) that wires all packages together at startup.
2. An **ESLint boundary plugin** configuration that makes illegal cross-package imports a compile-time error.
3. A **bootstrap module** (`apps/api/src/bootstrap.ts`) that constructs the full object graph in the correct order.
4. A passing **architecture test** that asserts the dependency rules from Spec 1 §5.

This is the last "pure infrastructure" day. From Day 06 onward, every day builds a real subsystem.

---

## 2. Design Decisions

### 2.1 Dependency Rules (Spec 1 §5 — restated as enforceable rules)

| Rule | Statement |
|------|-----------|
| R1 | `packages/domain` imports **nothing** from other `@harness/*` packages. |
| R2 | `packages/event-bus` imports only from `@harness/domain`. |
| R3 | `packages/db` imports only from `@harness/domain` and `@harness/event-bus`. |
| R4 | Engine packages (`orchestrator`, `agent-runtime`, `context-engine`, `artifact-tracker`, `attention-engine`, `verification-engine`) import only from `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`. **Never from each other.** |
| R5 | `apps/api` and `apps/web` may import from any `@harness/*` package. |
| R6 | `packages/review` imports only from `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`. |

**Why R4 is non-negotiable:** The moment `agent-runtime` imports from `artifact-tracker`, the event bus becomes optional. Engineers will call each other directly "just this once" and the control plane dissolves. All inter-engine communication goes through the event bus.

### 2.2 DI Container Design

Phase 1 uses a **hand-rolled container** — no external DI library. The object graph is small enough to wire explicitly; an external library adds indirection without payoff at this scale.

```typescript
// packages/di/src/container.ts
export class Container {
  private readonly instances = new Map<string, unknown>();

  register<T>(token: string, factory: (c: Container) => T): void { ... }
  resolve<T>(token: string): T { ... }  // throws if not registered
}
```

Tokens are string constants defined in `packages/di/src/tokens.ts`:

```typescript
export const TOKENS = {
  EventBus:           'EventBus',
  Db:                 'Db',
  EventLogWriter:     'EventLogWriter',
  Orchestrator:       'Orchestrator',
  AgentRuntime:       'AgentRuntime',
  ContextEngine:      'ContextEngine',
  ArtifactTracker:    'ArtifactTracker',
  AttentionEngine:    'AttentionEngine',
  VerificationEngine: 'VerificationEngine',
} as const;
```

**Why string tokens, not class references?** Class-reference DI requires the class to exist at registration time, which creates import cycles. String tokens decouple registration from resolution.

### 2.3 Bootstrap Order

The bootstrap module constructs dependencies in strict topological order:

```
1. EventBus          (no deps)
2. Db                (needs DATABASE_URL)
3. EventLogWriter    (needs Db, EventBus)
4. ArtifactTracker   (needs Db, EventBus)
5. ContextEngine     (needs Db)
6. AgentRuntime      (needs EventBus, ContextEngine, ArtifactTracker)
7. VerificationEngine(needs Db, EventBus)
8. AttentionEngine   (needs Db, EventBus)
9. Orchestrator      (needs Db, EventBus, AgentRuntime, VerificationEngine)
10. Review API       (needs Db, EventBus)
```

Note: engines receive `IEventBus` (the interface), never `InProcessEventBus` (the concrete class). This is enforced by the DI container's type signatures.

### 2.4 ESLint Boundary Enforcement

Use `eslint-plugin-boundaries` (already in devDeps from Day 01). Configure in root `.eslintrc.cjs`:

```javascript
settings: {
  'boundaries/elements': [
    { type: 'domain',       pattern: 'packages/domain' },
    { type: 'event-bus',    pattern: 'packages/event-bus' },
    { type: 'db',           pattern: 'packages/db' },
    { type: 'di',           pattern: 'packages/di' },
    { type: 'engine',       pattern: 'packages/*', capture: ['name'] },
    { type: 'app',          pattern: 'apps/*' },
  ],
  'boundaries/include': ['packages/**/*.ts', 'apps/**/*.ts'],
},
rules: {
  'boundaries/element-types': ['error', {
    default: 'disallow',
    rules: [
      { from: 'domain',    allow: [] },
      { from: 'event-bus', allow: ['domain'] },
      { from: 'db',        allow: ['domain', 'event-bus'] },
      { from: 'di',        allow: ['domain', 'event-bus', 'db'] },
      { from: 'engine',    allow: ['domain', 'event-bus', 'db', 'di'] },
      { from: 'app',       allow: ['domain', 'event-bus', 'db', 'di', 'engine'] },
    ],
  }],
}
```

---

## 3. Tasks

### 3.1 Scaffold `packages/di` (30 min)

- [ ] `packages/di/package.json` — name `@harness/di`; deps: none (pure TS).
- [ ] `packages/di/tsconfig.json`.
- [ ] `packages/di/src/index.ts` — barrel.

### 3.2 Implement `Container` (60 min)

- [ ] `packages/di/src/container.ts`:
  - `register<T>(token: string, factory: (c: Container) => T): void` — lazy: factory is called once on first `resolve`, result cached.
  - `resolve<T>(token: string): T` — throws `ContainerError` with token name if not registered.
  - `has(token: string): boolean`.
  - `reset(): void` — clears all instances (for tests).
- [ ] `packages/di/src/tokens.ts` — `TOKENS` const object (§2.2).
- [ ] `packages/di/src/errors.ts` — `ContainerError` with `token` field.
- [ ] Tests: lazy resolution, caching (factory called once), `ContainerError` on unknown token, `reset` clears cache.

### 3.3 Configure ESLint boundaries (60 min)

- [ ] Install `eslint-plugin-boundaries` if not already present.
- [ ] Update root `.eslintrc.cjs` with the configuration from §2.4.
- [ ] Verify: `pnpm lint` passes on existing packages (domain, event-bus, db).
- [ ] Verify: deliberately add an illegal import to `packages/event-bus/src/index.ts` (e.g., `import { createDb } from '@harness/db'`), run `pnpm lint`, confirm it fails. Remove the illegal import.

### 3.4 Write bootstrap module (60 min)

- [ ] `apps/api/src/bootstrap.ts`:

```typescript
export function buildContainer(): Container {
  const c = new Container();

  c.register(TOKENS.EventBus,           () => new InProcessEventBus());
  c.register(TOKENS.Db,                 () => createDb(process.env.DATABASE_URL!));
  c.register(TOKENS.EventLogWriter,     (c) => {
    const writer = new EventLogWriter(c.resolve(TOKENS.Db));
    writer.subscribeTo(c.resolve(TOKENS.EventBus));
    return writer;
  });
  // Engine registrations added on their respective build days.
  // Today: register stubs that throw "not yet implemented".

  return c;
}
```

- [ ] Call `buildContainer()` in `apps/api/src/index.ts` at startup; log each registered token.

### 3.5 Architecture test (90 min)

Write `packages/di/src/__tests__/architecture.test.ts` — a test that reads the actual `package.json` of each package and asserts dependency rules:

- [ ] R1: `packages/domain/package.json` has zero `@harness/*` entries in `dependencies`.
- [ ] R2: `packages/event-bus/package.json` has only `@harness/domain`.
- [ ] R3: `packages/db/package.json` has only `@harness/domain` and `@harness/event-bus`.
- [ ] R4: each engine package `package.json` has no other engine packages in `dependencies`.
- [ ] Bootstrap order test: `buildContainer()` resolves all tokens without throwing (stub engines are acceptable — they throw on method call, not on construction).

### 3.6 Document the wiring map (30 min)

- [ ] `docs/architecture/wiring-map.md` — table showing: token, concrete class, registered on (day), resolved by. Update this file each time a new engine is registered.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/di/src/container.ts` | `Container` class |
| `packages/di/src/tokens.ts` | `TOKENS` constants |
| `packages/di/src/errors.ts` | `ContainerError` |
| `apps/api/src/bootstrap.ts` | `buildContainer()` |
| `.eslintrc.cjs` (updated) | `boundaries` plugin config |
| `packages/di/src/__tests__/architecture.test.ts` | R1–R4 enforcement tests |
| `docs/architecture/wiring-map.md` | Living wiring document |

---

## 5. Acceptance Criteria

- [ ] `pnpm lint` — zero boundary violations.
- [ ] Deliberate illegal import produces a lint error (verified manually, then reverted).
- [ ] `pnpm --filter @harness/di test` — all tests pass.
- [ ] `buildContainer()` resolves `EventBus`, `Db`, `EventLogWriter` without throwing.
- [ ] Architecture tests assert R1–R4 against actual `package.json` files (not hardcoded lists).
- [ ] `grep -r "from '@harness" packages/domain/src` — zero results.
- [ ] `docs/architecture/wiring-map.md` exists and lists today's 3 registrations.

---

## 6. Notes & Pitfalls

- **Do not use a DI library (tsyringe, inversify, etc.).** The container is ~40 lines. External DI libraries require decorators or reflect-metadata, which conflict with the plain-interface domain style.
- **String tokens vs symbols:** symbols are technically safer but cannot be serialised into config files or logged readably. String tokens are the right trade-off here.
- **`buildContainer` is the only place `new InProcessEventBus()` appears.** If you find `new InProcessEventBus()` anywhere else, that is a violation — resolve `TOKENS.EventBus` instead.
- **Stub registrations today:** register each engine token with a factory that returns a `Proxy` throwing `"X not yet implemented"` on any method call. This lets the architecture test pass without waiting for real implementations.
- **ESLint boundaries plugin version:** pin to `^4.x`. v3 has a different config schema and the §2.4 snippet will not work.
- **`docs/architecture/wiring-map.md` is a living document.** Add a row every time a new engine is registered. It takes 2 minutes per day and saves hours of archaeology later.

---

*Prev: [Day 04 — PostgreSQL Schema & Migrations](day-04.md) | Next: [Day 06 — Canonical Task State Machine](day-06.md)*
