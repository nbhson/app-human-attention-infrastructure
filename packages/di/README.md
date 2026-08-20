# @harness/di — Dependency Injection Container

## Hiểu nhanh

**Nhiệm vụ:** "người nối dây" — dependency injection container nối các package lại với nhau lúc khởi động.

Nói nôm na: các package chỉ nhận *interface*, không biết nhau cụ thể. Gói này cắm dây cho chúng lúc startup, để sau này swap cái nào cũng chỉ đổi ở một chỗ.

---

## Trạng thái hiện tại

**Package chưa tồn tại** — cần tạo mới.

---

## Mục đích

Wire các package lại với nhau tại startup. Cung cấp interface-based injection — engines nhận interface, không phải concrete implementation.

---

## Công việc cần làm (Day 05)

### 1. Container implementation

```typescript
// packages/di/src/container.ts
export class Container {
  private readonly registry = new Map<symbol, () => unknown>();
  private readonly singletons = new Map<symbol, unknown>();

  register<T>(token: symbol, factory: () => T): void {
    this.registry.set(token, factory);
  }

  resolve<T>(token: symbol): T {
    if (this.singletons.has(token)) {
      return this.singletons.get(token) as T;
    }
    const factory = this.registry.get(token);
    if (!factory) throw new Error(`No registration for ${token.toString()}`);
    const instance = factory();
    this.singletons.set(token, instance);
    return instance;
  }
}
```

### 2. Token definitions

```typescript
// packages/di/src/tokens.ts
export const TOKENS = {
  EventBus: Symbol.for('IEventBus'),
  Db: Symbol.for('Db'),
  TaskService: Symbol.for('TaskService'),
  VerificationEngine: Symbol.for('IVerificationEngine'),
  AttentionEngine: Symbol.for('IAttentionEngine'),
  ContextEngine: Symbol.for('IContextEngine'),
  ReviewService: Symbol.for('ReviewService'),
  DispatchLoop: Symbol.for('DispatchLoop'),
} as const;
```

### 3. Bootstrap wiring

```typescript
// packages/di/src/bootstrap.ts
export function buildContainer(): Container {
  const container = new Container();

  // Infrastructure (inward dependencies first)
  container.register(TOKENS.EventBus, () => new InProcessEventBus());
  container.register(TOKENS.Db, () => new DrizzleDB(process.env.DATABASE_URL!));

  // Domain services
  container.register(TOKENS.TaskService, () => new TaskService(
    container.resolve(TOKENS.Db),
    container.resolve(TOKENS.EventBus),
  ));

  // Engines (receive interfaces, not implementations)
  container.register(TOKENS.VerificationEngine, () => new VerificationEngine(
    container.resolve(TOKENS.Db),
    container.resolve(TOKENS.EventBus),
  ));

  container.register(TOKENS.AttentionEngine, () => new AttentionEngine(
    container.resolve(TOKENS.Db),
    container.resolve(TOKENS.EventBus),
  ));

  container.register(TOKENS.ContextEngine, () => new ContextEngine(
    container.resolve(TOKENS.Db),
  ));

  container.register(TOKENS.ReviewService, () => new ReviewService(
    container.resolve(TOKENS.Db),
    container.resolve(TOKENS.EventBus),
    container.resolve(TOKENS.AttentionEngine),
  ));

  // Orchestrator
  container.register(TOKENS.DispatchLoop, () => new DispatchLoop(
    container.resolve(TOKENS.TaskService),
    container.resolve(TOKENS.EventBus),
  ));

  return container;
}
```

### 4. Boundary enforcement

ESLint rule trong `eslint.config.mjs`:

```javascript
// packages/orchestrator cannot import packages/verification-engine directly
{
  rules: {
    'boundary-enforcement/enforce': [{
      from: 'packages/orchestrator',
      not: ['packages/verification-engine', 'packages/attention-engine', 'packages/context-engine'],
    }],
  }
}
```

### 5. apps/api/src/index.ts — Startup

```typescript
import { buildContainer } from '@harness/di';

const container = buildContainer();
const taskService  = container.resolve<TaskService>(TOKENS.TaskService);
const bus          = container.resolve<IEventBus>(TOKENS.EventBus);
const db           = container.resolve<DrizzleDB>(TOKENS.Db);
const dispatchLoop = container.resolve<DispatchLoop>(TOKENS.DispatchLoop);

// Start dispatch loop on boot
dispatchLoop.start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  dispatchLoop.stop();
  await db.destroy();
  process.exit(0);
});
```

---

## Dependency rule

```
packages/di → import @harness/domain, @harness/event-bus, @harness/db
            → KHÔNG import các engine packages (chỉ wire chúng, không depend)
```

---

## Files cần tạo

```
packages/di/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── container.ts          # Container class
│   ├── tokens.ts             # Symbol tokens
│   └── bootstrap.ts          # Wiring all packages
└── __tests__/
    └── container.test.ts
```
