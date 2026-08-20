# @harness/db — Database Layer

## Hiểu nhanh

**Nhiệm vụ:** "kho lưu trữ" — PostgreSQL schema (12 bảng), migration, và lớp truy cập dữ liệu để mọi package đọc/ghi.

Nói nôm na: đây là tủ hồ sơ của cả hệ thống. Mọi thứ ghi vào đây để không mất và truy vết được về sau. Riêng bảng `event_log` là **append-only** — nguồn sự thật về "*chuyện gì đã xảy ra*"; các bảng còn lại chỉ là "ảnh chụp hiện trạng" có thể dựng lại bằng cách replay `event_log`.

---

## Trạng thái hiện tại

**Đã triển khai (Day 04).** Schema đầy đủ 12 bảng, migration đầu tiên đã sinh & áp dụng, seed data, `createDb`, và `EventLogWriter`.

---

## Mục đích

Trừu tượng hoá PostgreSQL storage qua **Drizzle ORM** (driver `postgres.js`). Cung cấp schema definitions, migration runner, and a repository/migration surface cho các package phía trên.

---

## Cài đặt & chạy (local)

```bash
docker compose up -d postgres        # Postgres 16 healthy
cp .env.example .env                 # DATABASE_URL=postgres://harness:harness@localhost:5432/harness

pnpm --filter @harness/db generate   # sinh migration từ diff schema (chỉ khi sửa schema)
pnpm --filter @harness/db migrate    # áp migration
pnpm --filter @harness/db seed       # nạp 1 project + 3 tasks mẫu
pnpm --filter @harness/db build      # tsc build
pnpm test                            # chạy toàn bộ test (gồm db) từ repo root
```

> **Không dùng `drizzle-kit push`** sau migration đầu tiên — `push` bỏ qua lịch sử migration. Luôn `generate` → review → `migrate`.

---

## Schema — 12 bảng

| File | Bảng | Package sở hữu logic |
|------|------|---------------------|
| `projects.ts` | `projects` | orchestrator |
| `tasks.ts` | `tasks` | orchestrator |
| `agent-runs.ts` | `agent_runs` | agent-runtime |
| `artifacts.ts` | `artifacts` | artifact-tracker |
| `changes.ts` | `changes` | artifact-tracker |
| `snapshots.ts` | `snapshots` | artifact-tracker |
| `contexts.ts` | `contexts` | context-engine |
| `verification-requests.ts` | `verification_requests` | verification-engine |
| `verification-results.ts` | `verification_results` | verification-engine |
| `assessments.ts` | `assessments` | attention-engine |
| `decisions.ts` | `decisions` | review |
| `event-log.ts` | `event_log` | db (own) |

*(`review_queue` và `trajectory_steps` không thuộc Day 04 — thêm sau khi spec yêu cầu.)*

---

## Quy tắc thiết kế schema

- **Primary key**: `text` (chuỗi UUIDv7 từ domain) — không dùng `serial int`.
- **Status/type columns**: `text` + **CHECK constraint** (đọc được trong raw SQL). Giá trị được liệt kê tường minh trong `schema/enums.ts` và được khoá khớp với `@harness/domain` bằng drift-test `enums.test.ts`.
- **`tasks.state`**: 13 trạng thái canonical (domain `TaskStatus`, gồm cả `RETRYING`) — CHECK liệt kê đầy đủ.
- **Timestamp**: `timestamptz` (UTC) mọi nơi — `timestamp(..., { withTimezone: true })`.
- **JSON**: `jsonb` (payload, metadata, sources, check_results, factors_unavailable).
- **`event_log`**: append-only (không UPDATE/DELETE), indexed trên `correlation_id`, `event_type`, `occurred_at`.

---

## EventLogWriter

`src/event-log-writer.ts` — đăng ký tất cả `EventType` lên `IEventBus` và ghi mỗi event vào `event_log`. Ghi là **fire-and-forget** (Phase 1): `publish` không block lên DB write; `.catch(console.error)` để không nuốt lỗi. Duplicate `event_id` là no-op nhờ `onConflictDoNothing()`.

```typescript
const db = createDb(process.env.DATABASE_URL!);
const writer = new EventLogWriter(db);
writer.subscribeTo(bus);
```

---

## Test strategy

- **Schema riêng** `harness_test` / `harness_test_writer`: `createTestDb()` tạo schema + `SET search_path` + migrate vào đó; `destroyTestDb()` drop toàn bộ bằng `DROP SCHEMA ... CASCADE`. Không bao giờ chạy test trên dev DB.
- Migration SQL được sinh với FK reference **unqualified** (đã bỏ prefix `public`) để áp được vào schema bất kỳ qua `search_path`.
- Tests chạy qua `pnpm test` (root vitest), không phải `pnpm --filter @harness/db test`.

---

## Dependency rule

```
packages/db → chỉ import @harness/domain + @harness/event-bus (cho IEventBus)
            → KHÔNG import các engine packages khác
```

> Ghi chú: schema files KHÔNG import `@harness/domain` lúc runtime (để `drizzle-kit generate` không phải kéo ESM workspace package); toàn bộ status values nằm trong `schema/enums.ts` và được drift-test khoá với domain.

---

## Files

```
src/
├── index.ts               # barrel: schema + createDb + EventLogWriter
├── client.ts              # createDb(connectionString): DrizzleDB
├── event-log-writer.ts    # EventLogWriter
├── env.ts                 # load .env + requireConnectionString()
├── migrate.ts             # migration runner (tsx)
├── seed.ts                # dev seed (tsx)
├── schema/
│   ├── enums.ts           # CHECK constraints + value lists
│   ├── projects.ts / tasks.ts / agent-runs.ts / artifacts.ts / changes.ts
│   ├── snapshots.ts / contexts.ts / verification-requests.ts
│   ├── verification-results.ts / assessments.ts / decisions.ts / event-log.ts
│   └── index.ts           # table barrel (relational schema registry)
└── __tests__/helpers.ts   # createTestDb / destroyTestDb
migrations/                # generated SQL (committed)
drizzle.config.ts
```