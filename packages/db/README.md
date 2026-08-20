# @harness/db — Database Layer

## Trạng thái hiện tại

Stubs: `src/index.ts` chỉ export string `'db'`. Chưa có schema, chưa có migration.

---

## Mục đích

Trừu tượng hóa PostgreSQL storage qua Drizzle ORM. Cung cấp schema definitions, migrations, và repository pattern.

---

## Công việc cần làm (Day 04)

### 1. Scaffold package

```bash
# Thêm dependencies
pnpm add -F @harness/db drizzle-orm postgres
pnpm add -D -F @harness/db drizzle-kit
```

**package.json**: name = `@harness/db`, deps = `drizzle-orm`, `postgres`, `@harness/domain`

### 2. Drizzle schema — 14 tables

Mỗi table group trong một file riêng tại `src/schema/`:

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
| `review-queue.ts` | `review_queue` | review |
| `trajectory-steps.ts` | `trajectory_steps` | agent-runtime |
| `event-log.ts` | `event_log` | db (own) |

### 3. Quy tắc thiết kế schema

```typescript
// Primary keys: text (UUIDv7 string), KHÔNG dùng serial int
id: text('id').primaryKey()

// Status fields: text + CHECK constraint
state: text('state')
  .notNull()
  .default('PENDING')
  .check("state IN ('PENDING', 'QUEUED', 'EXECUTING', ...)")

// Timestamps: timestamptz (UTC)
created_at: timestamp('created_at', { withTimezone: true })
  .notNull()
  .defaultNow()

// JSON fields: jsonb
metadata: jsonb('metadata').notNull().default({})
payload: jsonb('payload').notNull().default({})

// Content hash: text (SHA-256 hex)
content_hash: text('content_hash').notNull()

// Correlation ID: indexed
correlation_id: text('correlation_id').notNull()
// → createIndex trên correlation_id
```

### 4. Migration runner (`src/migrate.ts`)

```typescript
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const db = drizzle(postgres(process.env.DATABASE_URL!));
await migrate(db, { migrationsFolder: './migrations' });
await db.destroy();
```

Chạy bằng: `pnpm --filter @harness/db migrate`

### 5. Drizzle config (`drizzle.config.ts`)

```typescript
export default {
  schema: './src/schema/*.ts',
  out: './migrations',
  driver: 'pg',
  dbCredentials: { connectionString: process.env.DATABASE_URL! },
};
```

### 6. EventLogWriter subscriber

Persist mọi event từ `IEventBus` vào `event_log` table:

```typescript
export class EventLogWriter {
  constructor(private db: Db, private bus: IEventBus) {
    bus.subscribe('*', async (event) => {
      await db.insert(eventLog).values({
        id: event.event_id,
        event_type: event.event_type,
        event_version: event.event_version,
        occurred_at: event.occurred_at,
        correlation_id: event.correlation_id,
        payload: event.payload,
      });
    });
  }
}
```

**Quy tắc**: `event_log` là append-only — không UPDATE, không DELETE.

### 7. Repository pattern

Tạo repository interface + implementation cho mỗi aggregate root:

```typescript
export interface TaskRepository {
  create(task: Task): Promise<TaskID>;
  findById(id: TaskID): Promise<Task | null>;
  updateStatus(id: TaskID, newStatus: TaskStatus, expectedStatus: TaskStatus): Promise<void>;
  findPendingAndQueued(): Promise<Task[]>;
}
```

---

## Dependency rule

```
packages/db → chỉ import @harness/domain + @harness/event-bus
```

---

## Test strategy

- **Test schema riêng**: `harness_test` — tạo/xóa per test run, không dùng dev DB
- **Integration tests**: dùng test container hoặc local Postgres với schema riêng
- **Migration tests**: verify migration applies cleanly from empty DB

---

## Files cần tạo

```
src/
├── index.ts
├── db.ts            # PostgreSQL connection + Drizzle instance
├── migrate.ts       # Migration runner script
├── schema/
│   ├── projects.ts
│   ├── tasks.ts
│   ├── agent-runs.ts
│   ├── artifacts.ts
│   ├── changes.ts
│   ├── snapshots.ts
│   ├── contexts.ts
│   ├── verification-requests.ts
│   ├── verification-results.ts
│   ├── assessments.ts
│   ├── decisions.ts
│   ├── review-queue.ts
│   ├── trajectory-steps.ts
│   ├── event-log.ts
│   └── index.ts     # Barrel export
└── repositories/
    ├── task-repository.ts
    ├── artifact-repository.ts
    └── ...
migrations/          # Generated SQL
```
