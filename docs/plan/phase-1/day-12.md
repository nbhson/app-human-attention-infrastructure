# Day 12 — ReAct Loop

| | |
|---|---|
| **Week** | 2 — Execution Core |
| **Spec refs** | Spec 3 §5 (ReAct Loop), Spec 3 §6 (Agent Runner), Spec 3 §8 (Max Steps & Escalation) |
| **Estimated effort** | 7–8 hours |
| **Prerequisites** | Day 11 (LLMProvider + MockLLM + TokenBudget green) |

---

## 1. Objectives

By end of day you will have:

1. An **`AgentRun` record** — a DB row tracking a single agent execution session for a task.
2. A **`ReActLoop`** — the Think → Tool Call → Observe cycle, driven by `LLMProvider`.
3. An **`AgentRunner`** — creates `AgentRun`, runs the loop, handles `maxSteps` escalation.
4. A **`RuntimePollLoop`** — polls `QUEUED` tasks and hands them to `AgentRunner`.
5. **Completion handoff** — on loop finish, `AgentRunner` publishes `task.execution_finished` and returns control; the Orchestrator's `WorkflowRunner` continues from there.

---

## 2. Design Decisions

### 2.1 `AgentRun` Lifecycle

```
CREATED → RUNNING → COMPLETED
                  → FAILED
                  → ESCALATED   (maxSteps exceeded or TokenBudgetExceeded)
```

The `agent_runs` table (created Day 04) gets two new columns today: `current_step integer not null default 0` and `escalation_reason text`.

### 2.2 ReAct Loop Structure

```typescript
// packages/agent-runtime/src/react/react-loop.ts

export interface ReActStep {
  stepNumber: number;    // 1-based
  thought: string;       // model's reasoning text
  toolCall?: LLMToolCall;
  observation?: string;  // tool result text
}

export interface ReActResult {
  steps: ReActStep[];
  finalAnswer: string;
  stopReason: 'end_turn' | 'max_steps' | 'token_budget';
}

export class ReActLoop {
  constructor(
    private readonly llm: LLMProvider,
    private readonly tools: ToolRegistry,   // Day 13 — stub today
    private readonly budget: TokenBudget,
    private readonly maxSteps: number,
  ) {}

  async run(systemPrompt: string, userMessage: string): Promise<ReActResult> {
    const messages: LLMMessage[] = [{ role: 'user', content: userMessage }];
    const steps: ReActStep[] = [];

    for (let i = 1; i <= this.maxSteps; i++) {
      const response = await this.llm.complete({
        model: 'claude-sonnet-4-6',
        messages,
        maxTokens: 4096,
        systemPrompt,
        tools: this.tools.definitions(),
      });

      this.budget.consume(response.usage);

      if (response.stopReason === 'end_turn') {
        return { steps, finalAnswer: response.content, stopReason: 'end_turn' };
      }

      for (const call of response.toolCalls) {
        const observation = await this.tools.execute(call);
        steps.push({ stepNumber: i, thought: response.content, toolCall: call, observation });
        messages.push(
          { role: 'assistant', content: response.content },
          { role: 'user', content: `[Tool result for ${call.name}]: ${observation}` },
        );
      }
    }

    return { steps, finalAnswer: '', stopReason: 'max_steps' };
  }
}
```

### 2.3 `maxSteps` Escalation (Spec 3 §8)

When `stopReason === 'max_steps'`:

```
AgentRunner:
  → update agent_runs.status = 'ESCALATED', escalation_reason = 'MAX_STEPS_EXCEEDED'
  → transitionTask(taskId, 'AWAITING_HUMAN_INTERVENTION', 'agent-runtime')
  → publish task.execution_finished { outcome: 'ESCALATED' }
```

`maxSteps` default: **10**. Configurable via `AGENT_MAX_STEPS` env var. Do not silently continue past `maxSteps`.

### 2.4 `AgentRunner`

```typescript
// packages/agent-runtime/src/runner/agent-runner.ts

export class AgentRunner {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly llm: LLMProvider,
    private readonly taskService: TaskService,
    private readonly workflowRunner: WorkflowRunner,  // injected for completion handoff
  ) {}

  async runTask(taskId: TaskID): Promise<void> {
    // 1. Transition QUEUED → EXECUTING
    // 2. INSERT agent_runs row (status=RUNNING)
    // 3. Build TokenBudget (limit from env: AGENT_TOKEN_BUDGET, default 50_000)
    // 4. Run ReActLoop
    // 5a. On end_turn: update agent_run COMPLETED; run WorkflowRunner for VERIFY step
    // 5b. On max_steps/token_budget: escalate per §2.3
    // 6. Publish task.execution_finished
  }
}
```

### 2.5 `RuntimePollLoop`

```typescript
// packages/agent-runtime/src/runner/runtime-poll-loop.ts

export class RuntimePollLoop {
  start(intervalMs = 2000): void
  stop(): void
  get running(): boolean
}
```

Identical structure to `DispatchLoop` (Day 08) but polls `QUEUED` tasks and calls `AgentRunner.runTask`. Started in `apps/api/src/index.ts` alongside `DispatchLoop`.

### 2.6 Completion Handoff — No Direct Engine Calls

The Runtime never calls Verification Engine or Attention Engine. It:

1. Updates its own `agent_runs` row.
2. Publishes `task.execution_finished` with `{ agent_run_id, outcome, final_answer }`.
3. Calls `workflowRunner.run(taskId, LINEAR_WORKFLOW_V1)` — starting from the `VERIFY` step (context already collected, execution done).

The `WorkflowRunner` (Day 09) owns the remaining steps. This preserves R4: engines never import each other.

---

## 3. Tasks

### 3.1 Alter `agent_runs` table (30 min)

- [ ] Add `current_step integer not null default 0` and `escalation_reason text` to `packages/db/src/schema/agent-runs.ts`.
- [ ] `pnpm --filter @harness/db generate` → review → `migrate`.

### 3.2 Implement `ToolRegistry` stub (45 min)

- [ ] `packages/agent-runtime/src/tools/tool-registry.ts`:

```typescript
export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  register(tool: Tool): void { this.tools.set(tool.name, tool); }
  definitions(): LLMToolDefinition[] { /* map to LLMToolDefinition */ }
  async execute(call: LLMToolCall): Promise<string> {
    const tool = this.tools.get(call.name);
    if (!tool) throw new Error(`TOOL_NOT_FOUND: ${call.name}`);
    return tool.execute(call.input);
  }
}
```

- [ ] Register a single `noop` stub tool for today's tests.

### 3.3 Implement `ReActLoop` (120 min)

- [ ] `packages/agent-runtime/src/react/react-loop.ts` — as per §2.2.
- [ ] Handle `stopReason === 'tool_use'` with an empty `toolCalls` array: treat as `end_turn` (defensive).

### 3.4 Implement `AgentRunner` (120 min)

- [ ] `packages/agent-runtime/src/runner/agent-runner.ts` — as per §2.4.
- [ ] On `end_turn`: update `agent_runs.status = 'COMPLETED'`, call `workflowRunner.run`.
- [ ] On `max_steps` / `TokenBudgetExceededError`: escalate per §2.3.
- [ ] Publish `task.execution_finished` in all cases (success and escalation).

### 3.5 Implement `RuntimePollLoop` (60 min)

- [ ] `packages/agent-runtime/src/runner/runtime-poll-loop.ts` — as per §2.5.
- [ ] SQL: `SELECT id FROM tasks WHERE state = 'QUEUED' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED` (inside `db.transaction`).
- [ ] On unexpected `AgentRunner` error: log at `error` level, continue loop.

### 3.6 Wire in DI and startup (30 min)

- [ ] Add `TOKENS.AgentRunner`, `TOKENS.RuntimePollLoop`, `TOKENS.ToolRegistry` to `TOKENS`.
- [ ] `apps/api/src/bootstrap.ts` — register all three.
- [ ] `apps/api/src/index.ts` — start `RuntimePollLoop` alongside `DispatchLoop`; stop both on SIGTERM/SIGINT.
- [ ] Update `docs/architecture/wiring-map.md`.

### 3.7 Tests (180 min)

File: `packages/agent-runtime/src/__tests__/react-loop.test.ts`
- [ ] Single-turn: `end_turn` on first response → `finalAnswer` set, `steps` empty.
- [ ] Two-turn: first response has tool call → tool executes → second response is `end_turn` → 1 step recorded.
- [ ] `max_steps` reached: loop returns `stopReason: 'max_steps'`.
- [ ] `TokenBudgetExceededError` thrown by budget → propagates out of `run`.
- [ ] Tool call with unknown tool name → `TOOL_NOT_FOUND` error recorded as observation, loop continues.

File: `packages/agent-runtime/src/__tests__/agent-runner.test.ts`
- [ ] Happy path: task `QUEUED` → `EXECUTING`; `agent_runs` row created with `RUNNING` then `COMPLETED`.
- [ ] `task.execution_finished` published with `outcome: 'COMPLETED'`.
- [ ] Max steps: `agent_runs.status = 'ESCALATED'`, task → `AWAITING_HUMAN_INTERVENTION`.
- [ ] Token budget: same as max steps but `escalation_reason = 'TOKEN_BUDGET_EXCEEDED'`.
- [ ] `task.execution_finished` published on escalation with `outcome: 'ESCALATED'`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0006_*.sql` | agent_runs column additions |
| `packages/agent-runtime/src/tools/tool-registry.ts` | `ToolRegistry` + `Tool` interface |
| `packages/agent-runtime/src/react/react-loop.ts` | `ReActLoop` |
| `packages/agent-runtime/src/runner/agent-runner.ts` | `AgentRunner` |
| `packages/agent-runtime/src/runner/runtime-poll-loop.ts` | `RuntimePollLoop` |
| `apps/api/src/bootstrap.ts` (updated) | New registrations |
| `apps/api/src/index.ts` (updated) | Start RuntimePollLoop |
| 2 test files | Unit tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/agent-runtime test` — all tests pass.
- [ ] `pnpm --filter @harness/agent-runtime build` — clean build.
- [ ] `pnpm lint` — zero boundary violations.
- [ ] `agent_runs` has `current_step` and `escalation_reason` columns.
- [ ] `ReActLoop` stops at `maxSteps` and returns `stopReason: 'max_steps'`.
- [ ] Escalation path: task transitions to `AWAITING_HUMAN_INTERVENTION`.
- [ ] `RuntimePollLoop` starts/stops cleanly.
- [ ] `docs/architecture/wiring-map.md` updated.

---

## 6. Notes & Pitfalls

- **The `WorkflowRunner` call on success starts from step index 1 (`EXECUTE`) or 2 (`VERIFY`)?** Today, since `COLLECT_CONTEXT` and `EXECUTE` stubs return `ok: true`, call `workflowRunner.run(taskId, LINEAR_WORKFLOW_V1)` in full — the stubs will be replaced incrementally. When the real `COLLECT_CONTEXT` handler lands (Day 20), pass a `startFromStep` parameter to skip already-done steps.
- **Do not call `AttentionEngine` from `AgentRunner`.** Ever. The Runtime's job ends when it publishes `task.execution_finished`.
- **`current_step` on `agent_runs` is updated after each loop iteration.** If the process crashes, you can see exactly how far the agent got.
- **The `noop` tool is temporary.** Day 13 adds real tools (`read_file`, `write_file`, `run_command`). The `ToolRegistry` interface does not change.
- **`AGENT_TOKEN_BUDGET` default is 50,000 tokens.** At current Claude pricing that is ~$0.15 per run — a reasonable Phase 1 ceiling.
- **Tomorrow (Day 13):** Real tools + `TrajectoryRecorder` — the agent can read/write files and every step is recorded for provenance.

---

*Prev: [Day 11 — LLM Provider Adapter & MockLLM](day-11.md) | Next: [Day 13 — Tools & Trajectory Recorder](day-13.md)*
