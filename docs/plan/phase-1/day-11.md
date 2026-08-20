# Day 11 — LLM Provider Adapter & MockLLM

| | |
|---|---|
| **Week** | 2 — Execution Core |
| **Spec refs** | Spec 3 §3 (LLM Abstraction), Spec 3 §4 (Provider Interface), Spec 3 §9 (Testing Strategy) |
| **Estimated effort** | 7–8 hours |
| **Prerequisites** | Day 10 (Retry policy + idempotency green) |

---

## 1. Objectives

By end of day you will have:

1. An **`LLMProvider` interface** — the single abstraction through which all LLM calls flow.
2. An **`AnthropicProvider`** implementing `LLMProvider` using the official `@anthropic-ai/sdk`.
3. A **`MockLLM`** implementing `LLMProvider` with deterministic, scriptable responses — used in all tests.
4. A **`TokenBudget`** tracker — counts tokens per agent run and throws `TOKEN_BUDGET_EXCEEDED` when the limit is hit.
5. A `llm_call_log` table — every LLM request/response is persisted for provenance.

> **Rule:** No code outside `packages/agent-runtime` may import `@anthropic-ai/sdk` directly. The boundary linter enforces this.

---

## 2. Design Decisions

### 2.1 `LLMProvider` Interface

```typescript
// packages/agent-runtime/src/llm/llm-provider.ts

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  model: string;               // e.g. 'claude-sonnet-4-6'
  messages: LLMMessage[];
  maxTokens: number;
  systemPrompt?: string;
  /** Tool definitions in Anthropic tool-use format. */
  tools?: LLMToolDefinition[];
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
}

export interface LLMResponse {
  /** Raw text content blocks. */
  content: string;
  /** Tool use requests from the model, if any. */
  toolCalls: LLMToolCall[];
  /** Token usage for budget tracking. */
  usage: { inputTokens: number; outputTokens: number };
  /** Provider stop reason: 'end_turn' | 'tool_use' | 'max_tokens' | ... */
  stopReason: string;
}

export interface LLMToolCall {
  id: string;         // provider-assigned tool_use id
  name: string;
  input: Record<string, unknown>;
}

export interface LLMProvider {
  complete(request: LLMRequest): Promise<LLMResponse>;
}
```

**Why this shape?** It is a minimal superset of what Anthropic and OpenAI both provide. Phase 2 can add `OpenAIProvider` without changing callers.

### 2.2 `AnthropicProvider`

```typescript
// packages/agent-runtime/src/llm/anthropic-provider.ts

export class AnthropicProvider implements LLMProvider {
  constructor(private readonly apiKey: string) {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const client = new Anthropic({ apiKey: this.apiKey });
    const response = await client.messages.create({
      model:      req.model,
      max_tokens: req.maxTokens,
      system:     req.systemPrompt,
      messages:   req.messages,
      tools:      req.tools,
    });
    return mapAnthropicResponse(response); // pure function, unit-testable
  }
}
```

Keep `mapAnthropicResponse` as a separate pure function so you can test the mapping without making API calls.

### 2.3 `MockLLM`

```typescript
// packages/agent-runtime/src/llm/mock-llm.ts

export type MockScript = LLMResponse[];

export class MockLLM implements LLMProvider {
  private queue: LLMResponse[];
  public readonly calls: LLMRequest[] = [];

  constructor(script: MockScript) {
    this.queue = [...script];
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push(req);
    const next = this.queue.shift();
    if (!next) throw new Error('MockLLM: script exhausted');
    return next;
  }
}
```

**Design notes:**
- `calls` records every request — tests assert on prompt content without any mocking framework.
- Script exhaustion is an explicit error, not a silent `undefined`.
- For multi-turn ReAct tests (Day 12), provide one `LLMResponse` per turn in order.

### 2.4 `TokenBudget`

```typescript
// packages/agent-runtime/src/llm/token-budget.ts

export class TokenBudgetExceededError extends Error {
  constructor(used: number, limit: number) {
    super(`TOKEN_BUDGET_EXCEEDED: used=${used} limit=${limit}`);
    this.name = 'TokenBudgetExceededError';
  }
}

export class TokenBudget {
  private used = 0;
  constructor(private readonly limit: number) {}

  consume(usage: { inputTokens: number; outputTokens: number }): void {
    this.used += usage.inputTokens + usage.outputTokens;
    if (this.used > this.limit) throw new TokenBudgetExceededError(this.used, this.limit);
  }

  get remaining(): number { return this.limit - this.used; }
}
```

`TokenBudgetExceededError` is classified as `RESOURCE` by `classifyError` (Day 10) — the runner will retry after cooldown.

### 2.5 `llm_call_log` Table

```typescript
// packages/db/src/schema/llm-call-log.ts

export const llmCallLog = pgTable('llm_call_log', {
  id:             text('id').primaryKey(),                    // UUIDv7
  agent_run_id:   text('agent_run_id').references(() => agentRuns.id), // nullable until Day 12
  model:          text('model').notNull(),
  input_tokens:   integer('input_tokens').notNull(),
  output_tokens:  integer('output_tokens').notNull(),
  stop_reason:    text('stop_reason').notNull(),
  request_hash:   text('request_hash').notNull(),  // SHA-256 of serialised request — dedup/provenance
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

A `LoggingLLMProvider` decorator wraps any `LLMProvider` and writes to `llm_call_log` after each call — keeping logging orthogonal to the provider itself.

---

## 3. Tasks

### 3.1 Add `llm_call_log` table (30 min)

- [ ] `packages/db/src/schema/llm-call-log.ts` — as per §2.5.
- [ ] Export from `packages/db/src/schema/index.ts`.
- [ ] `pnpm --filter @harness/db generate` → review → `migrate`.

### 3.2 Implement `LLMProvider` types (45 min)

- [ ] `packages/agent-runtime/src/llm/llm-provider.ts` — all interfaces from §2.1.
- [ ] Export from `packages/agent-runtime/src/index.ts`.

### 3.3 Implement `MockLLM` (60 min)

- [ ] `packages/agent-runtime/src/llm/mock-llm.ts` — as per §2.3.
- [ ] Helper factory for tests:

```typescript
export function mockTextResponse(content: string, inputTokens = 10, outputTokens = 5): LLMResponse {
  return { content, toolCalls: [], usage: { inputTokens, outputTokens }, stopReason: 'end_turn' };
}

export function mockToolCallResponse(
  toolName: string,
  toolId: string,
  input: Record<string, unknown>,
): LLMResponse {
  return {
    content: '',
    toolCalls: [{ id: toolId, name: toolName, input }],
    usage: { inputTokens: 10, outputTokens: 8 },
    stopReason: 'tool_use',
  };
}
```

### 3.4 Implement `TokenBudget` (45 min)

- [ ] `packages/agent-runtime/src/llm/token-budget.ts` — as per §2.4.
- [ ] Unit tests: `consume` within budget does not throw; exceeding budget throws `TokenBudgetExceededError`; `remaining` decreases correctly.

### 3.5 Implement `AnthropicProvider` (90 min)

- [ ] Add `@anthropic-ai/sdk` to `packages/agent-runtime/package.json`.
- [ ] `packages/agent-runtime/src/llm/anthropic-provider.ts` — as per §2.2.
- [ ] `packages/agent-runtime/src/llm/map-anthropic-response.ts` — pure mapping function.
- [ ] Unit test `mapAnthropicResponse` with fixture JSON (no live API call).

### 3.6 Implement `LoggingLLMProvider` (60 min)

- [ ] `packages/agent-runtime/src/llm/logging-provider.ts`:

```typescript
export class LoggingLLMProvider implements LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    private readonly db: DrizzleDB,
  ) {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = await this.inner.complete(req);
    const requestHash = createHash('sha256').update(JSON.stringify(req)).digest('hex');
    await this.db.insert(llmCallLog).values({
      id: uuidv7(), agent_run_id: null, model: req.model,
      input_tokens: res.usage.inputTokens, output_tokens: res.usage.outputTokens,
      stop_reason: res.stopReason, request_hash: requestHash,
    });
    return res;
  }
}
```

### 3.7 Wire in DI (30 min)

- [ ] Add `TOKENS.LLMProvider` to `TOKENS`.
- [ ] `apps/api/src/bootstrap.ts`:

```typescript
c.register(TOKENS.LLMProvider, (c) => {
  const raw = process.env.ANTHROPIC_API_KEY
    ? new AnthropicProvider(process.env.ANTHROPIC_API_KEY)
    : new MockLLM([]); // empty script — tests inject their own
  return new LoggingLLMProvider(raw, c.resolve(TOKENS.Db));
});
```

- [ ] Update `docs/architecture/wiring-map.md`.

### 3.8 Tests (120 min)

File: `packages/agent-runtime/src/__tests__/mock-llm.test.ts`
- [ ] Returns scripted responses in order.
- [ ] Throws on script exhaustion.
- [ ] `calls` array records all requests.

File: `packages/agent-runtime/src/__tests__/token-budget.test.ts`
- [ ] Within-budget consume does not throw.
- [ ] Over-budget consume throws `TokenBudgetExceededError` with correct message.
- [ ] `remaining` is accurate after multiple consumes.

File: `packages/agent-runtime/src/__tests__/map-anthropic-response.test.ts`
- [ ] Maps text-only response correctly.
- [ ] Maps response with tool calls correctly.
- [ ] Maps `usage` fields correctly.

File: `packages/agent-runtime/src/__tests__/logging-provider.test.ts`
- [ ] Delegates to inner provider and returns its response.
- [ ] Writes exactly one `llm_call_log` row per call.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/llm-call-log.ts` | LLM call log table |
| `packages/db/migrations/0005_*.sql` | Migration |
| `packages/agent-runtime/src/llm/llm-provider.ts` | `LLMProvider` interface + types |
| `packages/agent-runtime/src/llm/mock-llm.ts` | `MockLLM` + factories |
| `packages/agent-runtime/src/llm/token-budget.ts` | `TokenBudget`, `TokenBudgetExceededError` |
| `packages/agent-runtime/src/llm/anthropic-provider.ts` | `AnthropicProvider` |
| `packages/agent-runtime/src/llm/map-anthropic-response.ts` | Pure response mapper |
| `packages/agent-runtime/src/llm/logging-provider.ts` | `LoggingLLMProvider` decorator |
| `apps/api/src/bootstrap.ts` (updated) | `LLMProvider` registration |
| 4 test files | Unit tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/agent-runtime test` — all tests pass.
- [ ] `pnpm --filter @harness/agent-runtime build` — clean build.
- [ ] `pnpm lint` — zero boundary violations; no direct `@anthropic-ai/sdk` import outside `agent-runtime`.
- [ ] `llm_call_log` table exists.
- [ ] `MockLLM` script exhaustion throws explicit error.
- [ ] `TokenBudget` throws on exceed with `TOKEN_BUDGET_EXCEEDED` in message.
- [ ] `LoggingLLMProvider` writes a log row per call.

---

## 6. Notes & Pitfalls

- **Never commit `.env` with a real API key.** Add `.env` to `.gitignore` (should already be there from Day 01). Use `.env.example` with `ANTHROPIC_API_KEY=your-key-here`.
- **`MockLLM` with an empty script is the default in `bootstrap.ts` when no API key is set.** This means the app starts but any LLM call fails loudly — correct behaviour for a dev environment without a key.
- **`agent_run_id` in `llm_call_log` is nullable today.** It gets populated from Day 12 onward when `AgentRun` exists. Do not backfill it — the null rows are valid provenance for pre-runtime calls.
- **`request_hash` is for dedup, not security.** SHA-256 of the serialised request lets you detect identical retries. It does not need to be cryptographically secret.
- **The `map-anthropic-response` fixture:** Save a real API response JSON to `fixtures/anthropic/` (with any sensitive content redacted) and load it in tests. Do not hand-craft the fixture from memory — SDK response shapes change.
- **Tomorrow (Day 12):** The ReAct loop — `AgentRunner` orchestrates Think → Tool Call → Observe using `LLMProvider`, `ToolRegistry`, and `TrajectoryRecorder`.

---

*Prev: [Day 10 — Retry, Failure & Idempotency](day-10.md) | Next: [Day 12 — ReAct Loop](day-12.md)*
