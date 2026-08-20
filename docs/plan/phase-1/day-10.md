# Day 10 — Retry, Failure & Idempotency

| | |
|---|---|
| **Week** | 2 — Execution Core |
| **Spec refs** | Spec 2 §9 (Idempotency & Retry), Spec 2 §11 (Failure Classification), Spec 3 §7 (Agent Failure Modes) |
| **Estimated effort** | 7–8 hours |
| **Prerequisites** | Day 09 (WorkflowRunner + task_step_log green) |

---

## 1. Objectives

By end of day you will have:

1. A **`FailureClass` taxonomy** — every failure is classified as `TRANSIENT`, `PERMANENT`, or `RESOURCE`.
2. A **`RetryPolicy`** — exponential backoff with jitter, max retry count per failure class, wired into `WorkflowRunner`.
3. A `retry_log` table — every retry attempt is auditable.
4. **Idempotency hardening** — a review pass over all DB writes to confirm `ON CONFLICT DO NOTHING` or natural-key dedup where needed.
5. An updated `WorkflowRunner` that consults `RetryPolicy` before escalating to `AWAITING_HUMAN_INTERVENTION`.

---

## 2. Design Decisions

### 2.1 Failure Classification

Not all failures are equal. The system must distinguish:

```typescript
// packages/orchestrator/src/retry/failure-class.ts

export const FailureClass = {
  /** Network blip, DB lock timeout, LLM rate-limit — safe to retry. */
  TRANSIENT:  'TRANSIENT',
  /** Bad input, missing artifact, logic error — retrying will not help. */
  PERMANENT:  'PERMANENT',
  /** Token budget exceeded, disk full — retry after cooldown. */
  RESOURCE:   'RESOURCE',
} as const;
export type FailureClass = typeof FailureClass[keyof typeof FailureClass];

export interface ClassifiedFailure {
  class: FailureClass;
  message: string;
  /** Original error string for debugging. */
  raw: string;
}
```

Handlers add a `failureClass` field to their `StepResult` when `ok: false`. The runner uses it to decide retry vs. escalate.

**Classification guide for handler implementers:**

| Error | FailureClass | Rationale |
|-------|-------------|-----------|
| `ECONNRESET`, `ETIMEDOUT` | `TRANSIENT` | Network is flaky |
| `STEP_TIMEOUT` | `TRANSIENT` | Slow dependency, not broken |
| `23505` (unique violation) | `PERMANENT` | Data conflict won't resolve |
| `42P01` (undefined table) | `PERMANENT` | Schema bug |
| `LLM_RATE_LIMIT` | `RESOURCE` | Cooldown then retry |
| `TOKEN_BUDGET_EXCEEDED` | `RESOURCE` | Cooldown then retry |

### 2.2 Retry Policy

```typescript
// packages/orchestrator/src/retry/retry-policy.ts

export interface RetryPolicyConfig {
  maxRetries: Record<FailureClass, number>;
  baseDelayMs: number;   // e.g. 1000
  maxDelayMs: number;    // e.g. 30_000
  jitterFactor: number;  // 0..1, e.g. 0.2
}

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxRetries: {
    TRANSIENT:  3,
    PERMANENT:  0,   // never retry
    RESOURCE:   2,
  },
  baseDelayMs: 1_000,
  maxDelayMs:  30_000,
  jitterFactor: 0.2,
};

export function computeDelay(
  attempt: number,   // 1-based
  config: RetryPolicyConfig,
): number {
  const exponential = Math.min(
    config.baseDelayMs * 2 ** (attempt - 1),
    config.maxDelayMs,
  );
  const jitter = exponential * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.round(exponential + jitter);
}

export function shouldRetry(
  failure: ClassifiedFailure,
  attempt: number,
  config: RetryPolicyConfig,
): boolean {
  return attempt <= config.maxRetries[failure.class];
}
```

### 2.3 Retry in WorkflowRunner

Update the step-failure branch from Day 09:

```
StepResult.ok === false
  → classify failure → ClassifiedFailure
  → shouldRetry(failure, attemptNumber)?
      YES → insert retry_log row → sleep(computeDelay) → retry same step
      NO  → update task_step_log to FAILED → transitionTask → AWAITING_HUMAN_INTERVENTION
```

The runner tracks `attemptNumber` per step in-memory (resets to 1 when a new step starts). It is **not** the same as `tasks.attempt_number` (which tracks full task REWORK cycles).

### 2.4 `retry_log` Table

```typescript
// packages/db/src/schema/retry-log.ts

export const retryLog = pgTable('retry_log', {
  id:             text('id').primaryKey(),                    // UUIDv7
  task_id:        text('task_id').notNull().references(() => tasks.id),
  step_index:     integer('step_index').notNull(),
  attempt_number: integer('attempt_number').notNull(),
  failure_class:  text('failure_class').notNull(),            // FailureClass
  error_message:  text('error_message').notNull(),
  delay_ms:       integer('delay_ms').notNull(),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### 2.5 Idempotency Audit Checklist

Review every `INSERT` in the codebase today and confirm one of the following guards:

| Table | Guard |
|-------|-------|
| `event_log` | `onConflictDoNothing()` on `event_id` |
| `dispatch_log` | `idempotency_key` unique constraint |
| `task_state_history` | Natural dedup: `(task_id, from_state, to_state, attempt_number)` — duplicate transitions impossible via optimistic lock |
| `task_step_log` | No natural key — acceptable in Phase 1 (retry inserts a new row by design) |
| `retry_log` | No natural key — acceptable (each retry is a distinct event) |

---

## 3. Tasks

### 3.1 Add `retry_log` table (30 min)

- [ ] `packages/db/src/schema/retry-log.ts` — as per §2.4.
- [ ] Export from `packages/db/src/schema/index.ts`.
- [ ] `pnpm --filter @harness/db generate` → review → `migrate`.

### 3.2 Implement failure classification (45 min)

- [ ] `packages/orchestrator/src/retry/failure-class.ts` — `FailureClass`, `ClassifiedFailure`, classification guide comment.
- [ ] `packages/orchestrator/src/retry/classify-error.ts`:

```typescript
export function classifyError(err: unknown): ClassifiedFailure {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNRESET|ETIMEDOUT|STEP_TIMEOUT|ECONNREFUSED/i.test(msg)) {
    return { class: 'TRANSIENT', message: msg, raw: msg };
  }
  if (/RATE_LIMIT|TOKEN_BUDGET|QUOTA/i.test(msg)) {
    return { class: 'RESOURCE', message: msg, raw: msg };
  }
  return { class: 'PERMANENT', message: msg, raw: msg };
}
```

- [ ] Export both from `packages/orchestrator/src/index.ts`.

### 3.3 Implement `RetryPolicy` (60 min)

- [ ] `packages/orchestrator/src/retry/retry-policy.ts` — `RetryPolicyConfig`, `DEFAULT_RETRY_POLICY`, `computeDelay`, `shouldRetry` as per §2.2.
- [ ] Unit tests for `computeDelay`: delay increases exponentially; never exceeds `maxDelayMs`; jitter is within expected range.
- [ ] Unit tests for `shouldRetry`: `PERMANENT` always returns `false`; `TRANSIENT` returns `false` after `maxRetries.TRANSIENT`.

### 3.4 Update `StepResult` to include `failureClass` (20 min)

- [ ] In `packages/orchestrator/src/workflow/step-handler.ts`, update:

```typescript
export type StepResult =
  | { ok: true;  output: Record<string, unknown> }
  | { ok: false; error: string; failureClass: FailureClass; retriable: boolean };
```

- [ ] Update all stub handlers in `bootstrap.ts` to include `failureClass: 'PERMANENT'` (they never fail, but satisfy the type).

### 3.5 Update `WorkflowRunner` with retry logic (120 min)

- [ ] `packages/orchestrator/src/workflow/workflow-runner.ts` — replace the fail-fast branch:

```typescript
// Inside the step loop, on ok === false:
const failure: ClassifiedFailure = {
  class:  result.failureClass,
  message: result.error,
  raw:     result.error,
};

let attempt = 1;
while (shouldRetry(failure, attempt, this.retryPolicy)) {
  const delay = computeDelay(attempt, this.retryPolicy);
  await this.insertRetryLog(ctx, attempt, failure, delay);
  await sleep(delay);
  const retryResult = await this.executeStep(step, ctx);
  if (retryResult.ok) { /* mark COMPLETED, break out */ }
  attempt++;
}
// All retries exhausted or PERMANENT — escalate
```

- [ ] Inject `retryPolicy: RetryPolicyConfig` as a constructor parameter (default: `DEFAULT_RETRY_POLICY`).
- [ ] `sleep` utility: `const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));`

### 3.6 Idempotency audit pass (60 min)

- [ ] Grep for all `.insert(` calls in `packages/` — confirm each has a dedup guard per §2.5.
- [ ] Add `onConflictDoNothing()` to any `event_log` insert missing it.
- [ ] Write a short note in `docs/architecture/idempotency-audit.md` listing each table and its guard.

### 3.7 Tests (150 min)

File: `packages/orchestrator/src/__tests__/retry-policy.test.ts`
- [ ] `computeDelay(1)` ≈ `baseDelayMs` (±jitter).
- [ ] `computeDelay(5)` ≤ `maxDelayMs`.
- [ ] `shouldRetry(PERMANENT, 1)` → `false`.
- [ ] `shouldRetry(TRANSIENT, 3)` → `true`; `shouldRetry(TRANSIENT, 4)` → `false`.
- [ ] `shouldRetry(RESOURCE, 2)` → `true`; `shouldRetry(RESOURCE, 3)` → `false`.

File: `packages/orchestrator/src/__tests__/workflow-runner-retry.test.ts`
- [ ] TRANSIENT failure on step 0 retried up to 3 times, then escalates.
- [ ] `retry_log` has exactly 3 rows after exhaustion.
- [ ] TRANSIENT failure on step 0, success on retry 2: task stays `EXECUTING`, 2 `retry_log` rows, 1 `COMPLETED` step row.
- [ ] PERMANENT failure on step 0: no retries, immediate escalation.
- [ ] RESOURCE failure retried up to 2 times.
- [ ] `retry_log.delay_ms` values are positive integers.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/retry-log.ts` | Retry audit table |
| `packages/db/migrations/0004_*.sql` | Migration for retry_log |
| `packages/orchestrator/src/retry/failure-class.ts` | `FailureClass`, `ClassifiedFailure` |
| `packages/orchestrator/src/retry/classify-error.ts` | `classifyError` |
| `packages/orchestrator/src/retry/retry-policy.ts` | `RetryPolicyConfig`, `computeDelay`, `shouldRetry` |
| `packages/orchestrator/src/workflow/workflow-runner.ts` (updated) | Retry loop |
| `packages/orchestrator/src/__tests__/retry-policy.test.ts` | Policy unit tests |
| `packages/orchestrator/src/__tests__/workflow-runner-retry.test.ts` | Runner retry tests |
| `docs/architecture/idempotency-audit.md` | Idempotency guard inventory |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/orchestrator test` — all tests pass.
- [ ] `pnpm --filter @harness/orchestrator build` — clean build.
- [ ] `pnpm lint` — zero boundary violations.
- [ ] `retry_log` table exists.
- [ ] TRANSIENT step failure retried 3 times before escalation.
- [ ] PERMANENT failure never retried.
- [ ] `retry_log` row written for every retry attempt.
- [ ] `docs/architecture/idempotency-audit.md` exists and covers all insert paths.

---

## 6. Notes & Pitfalls

- **`tasks.attempt_number` and step-retry `attempt` are different counters.** The former tracks full REWORK cycles (incremented on `REWORK → QUEUED`); the latter is per-step in-memory. Do not conflate them.
- **Jitter is not optional.** Without jitter, N concurrent tasks all retry at the same instant — a thundering herd. The ±20% random factor breaks the synchronisation.
- **Do not retry `PERMANENT` failures "just in case".** A unique-constraint violation retried 3 times wastes 7 seconds and produces 3 identical errors.
- **`classifyError` is a heuristic.** It will misclassify sometimes. The `raw` field preserves the original message so you can improve the classifier without re-running tasks.
- **The `sleep` in tests:** Use `vi.useFakeTimers()` and `vi.advanceTimersByTime()` to avoid slow tests. Never `await sleep(30_000)` in a unit test.
- **Tomorrow (Day 11):** `LLMProvider` adapter + `MockLLM` — the first external dependency adapter, and the foundation for the Agent Runtime ReAct loop.

---

*Prev: [Day 09 — Linear Workflow Execution](day-09.md) | Next: [Day 11 — LLM Provider Adapter & MockLLM](day-11.md)*
