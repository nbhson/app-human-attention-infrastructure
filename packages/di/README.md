# @harness/di — Dependency Injection Container

## Hiểu nhanh

**Nhiệm vụ:** "người nối dây" — dependency injection container nối các package lại với nhau lúc khởi động.

Nói nôm na: các package chỉ nhận *interface*, không biết nhau cụ thể. Gói này cung cấp `Container` + `TOKENS` để `buildContainer()` (trong `apps/api`) cắm dây cho chúng lúc startup — swap cái gì chỉ đổi ở một chỗ.

---

## Mục đích

- `Container` — registry nội bộ (hand-rolled, ~40 dòng, không dùng thư viện DI).
- `TOKENS` — string constants dùng làm key đăng ký/resolve.
- `ContainerError` — lỗi khi resolve token chưa đăng ký.

Wire các package lại tại startup. Engines nhận `IEventBus` (interface), không phải `InProcessEventBus` (concrete).

---

## API

```typescript
import { Container, TOKENS, ContainerError } from '@harness/di';

const c = new Container();

c.register(TOKENS.EventBus, () => new InProcessEventBus()); // lazy: factory chỉ chạy ở lần resolve đầu
const bus = c.resolve(TOKENS.EventBus);                    // cache singleton
c.has(TOKENS.EventBus);                                     // true
c.reset();                                                  // xoá instances, giữ registrations
```

**Tại sao dùng string token, không dùng Symbol/class reference?** Class-reference DI đòi class tồn tại lúc đăng ký → tạo import cycle. String token tách registration khỏi resolution, và log/đọc được.

## Files

```
packages/di/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts                 # barrel
    ├── container.ts             # Container class + Factory<T>
    ├── tokens.ts                # TOKENS (string constants) + Token type
    ├── errors.ts                # ContainerError
    ├── container.test.ts        # lazy, cache-once, ContainerError, reset, has
    └── __tests__/
        └── architecture.test.ts # asserts R1–R4 against package.json
```

## Dependency rule (Spec 1 §5)

```
packages/di → KHÔNG import các engine packages (chỉ wire chúng, không depend)
```

`di` có quyền import `@harness/domain` / `@harness/event-bus` / `@harness/db` (thực tế hiện chưa cần — `Container`/`TOKENS` hoàn toàn pure TS).

## Ghi chú

- `buildContainer()` **không nằm ở đây** — nó nằm ở `apps/api/src/bootstrap.ts`, vì việc wire `InProcessEventBus`/`createDb` thuộc về application layer, còn `@harness/di` giữ thuần container.
- `new InProcessEventBus()` chỉ được phép xuất hiện đúng một chỗ: `apps/api/src/bootstrap.ts`.
- ESLint boundary rule (`eslint.config.mjs`) + `architecture.test.ts` cùng enforce R1–R4.