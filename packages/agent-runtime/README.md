# @harness/agent-runtime — AI Agent Runtime

## Trạng thái hiện tại

Stubs: `src/index.ts` chỉ export string `'agent-runtime'`. Chưa có implementation.

---

## Mục đích

Thực thi AI Agent trong sandbox — chạy ReAct loop (Think → Tool Call → Observe), ghi trajectory, trả về kết quả.

---

## Công việc cần làm

### Day 11 — LLMProvider Adapter

```typescript
// src/llm-provider.ts
export interface LLMProvider {
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  tool_calls?: ToolCall[];
}

export interface ChatResponse {
  message: ChatMessage;
  tokensUsed: number;
}

// Anthropic adapter
export class AnthropicLLMProvider implements LLMProvider { /* ... */ }

// Mock for testing
export class MockLLMProvider implements LLMProvider { /* ... */ }
```

### Day 12 — ReAct Loop

```typescript
// src/react-loop.ts
export async function runReActLoop(
  systemPrompt: string,
  tools: Tool[],
  maxSteps: number,
  llm: LLMProvider,
): Promise<AgentResult> {
  let messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  let steps: TrajectoryStep[] = [];

  for (let i = 0; i < maxSteps; i++) {
    const response = await llm.chat(messages, { tools });
    messages.push(response.message);
    steps.push({ type: 'THOUGHT', content: response.message.content });

    if (!response.message.tool_calls?.length) break; // done

    for (const toolCall of response.message.tool_calls) {
      const tool = tools.find(t => t.name === toolCall.name);
      const observation = await tool.execute(toolCall.arguments);
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: observation });
      steps.push({ type: 'TOOL_CALL', toolName: toolCall.name, observation });
    }
  }

  return { steps, finalMessage: messages[messages.length - 1] };
}
```

### Day 13 — Tools & Trajectory

**Tools** (`src/tools/file-tools.ts`):

```typescript
// read_file, write_file, list_directory
// Tất cả trong sandbox root, path safety checked
function resolveSafe(root: string, rel: string): string {
  const resolved = resolve(root, rel);
  if (!resolved.startsWith(resolve(root))) {
    throw new Error(`PATH_TRAVERSAL_REJECTED: ${rel}`);
  }
  return resolved;
}
```

**Tool allowlist** (`src/tools/tool-allowlist.ts`):

```typescript
const ALLOWED_TOOLS = new Set(
  (process.env.AGENT_ALLOWED_TOOLS ?? 'read_file,write_file,list_directory').split(',')
);
```

**Trajectory recorder** (`src/trajectory/trajectory-recorder.ts`):

```typescript
export class TrajectoryRecorder {
  async recordStep(runId: AgentRunID, step: TrajectoryStep): Promise<void> {
    await this.db.insert(trajectorySteps).values({
      id: newTrajectoryStepID(),
      agent_run_id: runId,
      step_number: step.stepNumber,
      step_type: step.type,
      content: step.content,
      created_at: new Date(),
    });
  }
}
```

### Day 13 — Artifact capture on write_file

Mỗi lần agent `write_file`, register artifact vào `artifact-tracker`:

```typescript
// Triggered inside write_file tool handler
await this.artifactCapture.capture({
  taskId,
  agentRunId,
  filePath: safePath,
  content: fileContent,
});
```

### Day 15 — Snapshot capture

Trước và sau agent run, capture file hashes để tạo diff:

```typescript
export class SnapshotCapture {
  async captureBefore(projectRoot: string): Promise<Record<string, string>> { /* sha256 of each file */ }
  async captureAfter(projectRoot: string, before: Record<string, string>): Promise<FileDiff[]> { /* diff vs before */ }
}
```

---

## Agent Run Lifecycle

```
INITIALIZED → PLANNING → EXECUTING (ReAct loop) → OBSERVING → FINALIZING
                                                                      │
                                              ┌───────────────────────┘
                                              ▼
                                         SUCCESS / FAILED
```

---

## Dependency rule

```
packages/agent-runtime → import @harness/domain, @harness/event-bus, @harness/db
                       → KHÔNG import engines packages khác
```

---

## Files cần tạo

```
src/
├── index.ts
├── agent-runner.ts             # Main entry: receive task → run loop → return result
├── react-loop.ts               # Think → Act → Observe cycle
├── llm-provider.ts             # LLMProvider interface
├── mock-llm.ts                 # MockLLM for testing
├── tool-registry.ts            # Tool registry + dispatch
├── tools/
│   ├── file-tools.ts           # read_file, write_file, list_directory
│   ├── resolve-safe.ts         # Path safety guard
│   └── tool-allowlist.ts       # Allowed tools per environment
├── trajectory/
│   ├── trajectory-recorder.ts  # Persist steps to DB
│   └── trajectory-builder.ts   # Assemble final trajectory
├── snapshot-capture.ts         # Before/after file hashes
└── __tests__/
    ├── agent-runner.test.ts
    ├── react-loop.test.ts
    ├── file-tools.test.ts
    └── trajectory-recorder.test.ts
```
