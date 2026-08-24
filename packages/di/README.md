# @harness/di — Dependency Injection Container

The hand-rolled dependency-injection container that joins the packages together
at startup — packages depend on *interfaces*, this package wires the concretes.

**Status:** complete (as-built) ·
**Boundary rule:** does not import the engine packages — it wires them, never depends on them.

---

## Purpose

1. **`Container`** — a hand-rolled registry (~40 lines, no DI library).
2. **`TOKENS`** — string constants used as registration/resolution keys.
3. **`ContainerError`** — raised when resolving an unregistered token.
4. **Logging helpers** — `createRootLogger` / `withCorrelation`.

Engines receive `IEventBus` (the interface), not `InProcessEventBus` (the
concrete class). Swapping an implementation changes exactly one place.

---

## Model

```text
                    buildContainer()  (apps/api/src/bootstrap.ts)
                                │
                                ▼
          ┌──────────────────────────────────────────┐
          │                Container                  │
          │  register(TOKENS.X, factory)  →  resolve()│
          │  (lazy: factory runs on first resolve)    │
          │  (cached singleton after that)            │
          └──────────────────────────────────────────┘
                                │
              injects interfaces into engines        TOKENS.*
```

---

## API

```typescript
import { Container, TOKENS, ContainerError } from '@harness/di';

const c = new Container();

c.register(TOKENS.EventBus, () => new InProcessEventBus()); // lazy factory
const bus = c.resolve(TOKENS.EventBus);                    // cached singleton
c.has(TOKENS.EventBus);                                     // true
c.reset();                                                  // clears instances, keeps registrations
```

**Why string tokens, not `Symbol`/class references?** Class-reference DI
requires the class to exist at registration time → import cycles. String tokens
separate registration from resolution and are readable/loggable.

---

## Modules

| Module | What it provides |
| --- | --- |
| `container.ts` | `Container` + `Factory<T>`. |
| `tokens.ts` | `TOKENS` (string constants) + `Token` type. |
| `errors.ts` | `ContainerError`. |
| `logger.ts` | `createRootLogger` / `withCorrelation`. |

---

## Notes

- `buildContainer()` does **not** live here — it lives in
  `apps/api/src/bootstrap.ts`, because wiring `InProcessEventBus`/`createDb` is
  an application-layer concern, while `@harness/di` stays a pure container.
- `new InProcessEventBus()` may appear in exactly one place:
  `apps/api/src/bootstrap.ts`.
- The ESLint boundary rule (`eslint.config.mjs`) + `architecture.test.ts` both
  enforce the boundary rules.

---

## Directory structure

```
src/
├── index.ts
├── container.ts
├── tokens.ts
├── errors.ts
└── logger.ts
```

## Public API surface

```typescript
// Container, Factory, TOKENS, Token, ContainerError, createRootLogger, withCorrelation
```

## Dependency rule

```
packages/di → does NOT import the engine packages (wires them only)
```