# Day 13 — Tools & Trajectory Recorder

| | |
|---|---|
| **Week** | 2 — Execution Core |
| **Spec refs** | Spec 3 §10 (Tool System), Spec 3 §11 (Trajectory Recording), Spec 5 §4 (Artifact Capture) |
| **Estimated effort** | 7–8 hours |
| **Prerequisites** | Day 12 (ReAct loop + AgentRunner green) |

---

## 1. Objectives

By end of day you will have:

1. **Three real tools** registered in `ToolRegistry`: `read_file`, `write_file`, `list_directory`.
2. A **tool allowlist** — only explicitly permitted tools are callable; the list is configurable per environment.
3. A **`TrajectoryRecorder`** — persists every `ReActStep` to a `trajectory_steps` table in real time.
4. A **`trajectory_steps` table** — full audit trail of agent reasoning + tool calls.
5. **Artifact capture on `write_file`** — every file the agent writes is registered in the `artifacts` table (Artifact Tracker stub; full engine lands Day 14).

---

## 2. Design Decisions

### 2.1 Tool Implementations

All tools operate within a **sandbox root directory** (`SANDBOX_ROOT` env var, default `./sandbox`). Paths are resolved relative to this root; absolute paths and `..` traversal are rejected.

```typescript
// packages/agent-runtime/src/tools/file-tools.ts

export function makeReadFileTool(sandboxRoot: string): Tool {
  return {
    name: 'read_file',
    description: 'Read the contents of a file relative to the sandbox root.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    async execute(input) {
      const safe = resolveSafe(sandboxRoot, String(input.path));
      return readFile(safe, 'utf8');
    },
  };
}

export function makeWriteFileTool(sandboxRoot: string): Tool { /* similar */ }
export function makeListDirectoryTool(sandboxRoot: string): Tool { /* similar */ }

function resolveSafe(root: string, rel: string): string {
  const resolved = resolve(root, rel);
  if (!resolved.startsWith(resolve(root))) {
    throw new Error(`PATH_TRAVERSAL_REJECTED: ${rel}`);
  }
  return resolved;
}
```

### 2.2 Tool Allowlist

```typescript
// packages/agent-runtime/src/tools/tool-allowlist.ts

export class ToolAllowlist {
  constructor(private readonly allowed: Set<string>) {}

  assertAllowed(toolName: string): void {
    if (!this.allowed.has(toolName)) {
      throw new Error(`TOOL_NOT_ALLOWED: ${toolName}`);
    }
  }
}
```

The allowlist is checked inside `ToolRegistry.execute` before dispatching to the tool. Configure via `AGENT_ALLOWED_TOOLS` env var (comma-separated, default: `read_file,write_file,list_directory`).

### 2.3 `trajectory_steps` Table

```typescript
// packages/db/src/schema/trajectory-steps.ts

export const trajectorySteps = pgTable('trajectory_steps', {
  id:             text('id').primaryKey(),                    // UUIDv7
  agent_run_id:   text('agent_run_id').notNull().references(() => agentRuns.id),
  step_number:    integer('step_number').notNull(),
  thought:        text('thought'),                            // nullable (may be empty string)
  tool_name:      text('tool_name'),                          // nullable (null on final answer step)
  tool_input:     jsonb('tool_input'),                        // nullable
  observation:    text('observation'),                        // nullable
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### 2.4 `TrajectoryRecorder`

```typescript
// packages/agent-runtime/src/trajectory/trajectory-recorder.ts

export class TrajectoryRecorder {
  constructor(private readonly db: DrizzleDB) {}

  async record(agentRunId: AgentRunID, step: ReActStep): Promise<void> {
    await this.db.insert(trajectorySteps).values({
      id:           uuidv7(),
      agent_run_id: agentRunId,
      step_number:  step.stepNumber,
      thought:      step.thought ?? null,
      tool_name:    step.toolCall?.name ?? null,
      tool_input:   step.toolCall?.input ?? null,
      observation:  step.observation ?? null,
    });
  }
}
```

`ReActLoop` calls `recorder.record` after each step — injection point added today.

### 2.5 Artifact Capture on `write_file`

When `write_file` succeeds, the tool emits an `artifact.created` event via the injected `IEventBus`:

```typescript
await bus.publish(createEvent('artifact.created', {
  agent_run_id: agentRunId,
  file_path: relPath,
  content_hash: sha256(content),
  size_bytes: Buffer.byteLength(content),
}));
```

A lightweight subscriber (`ArtifactCaptureSubscriber` in `packages/artifact-tracker`) inserts a minimal row into `artifacts` (full Tracker engine lands Day 14). This keeps Runtime decoupled from the Tracker.

---

## 3. Tasks

### 3.1 Add `trajectory_steps` table (30 min)

- [ ] `packages/db/src/schema/trajectory-steps.ts` — as per §2.3.
- [ ] Export from `packages/db/src/schema/index.ts`.
- [ ] `pnpm --filter @harness/db generate` → review → `migrate`.

### 3.2 Implement path safety utility (45 min)

- [ ] `packages/agent-runtime/src/tools/resolve-safe.ts` — `resolveSafe` as per §2.1.
- [ ] Unit tests: valid relative path resolves; `../escape` throws `PATH_TRAVERSAL_REJECTED`; absolute path outside root throws.

### 3.3 Implement file tools (90 min)

- [ ] `packages/agent-runtime/src/tools/file-tools.ts` — `makeReadFileTool`, `makeWriteFileTool`, `makeListDirectoryTool` as per §2.1.
- [ ] `write_file` creates parent directories recursively (`mkdir -p` semantics).
- [ ] `list_directory` returns newline-separated relative paths (files only, not directories).

### 3.4 Implement `ToolAllowlist` (30 min)

- [ ] `packages/agent-runtime/src/tools/tool-allowlist.ts` — as per §2.2.
- [ ] Integrate into `ToolRegistry.execute`: call `allowlist.assertAllowed(call.name)` before `tool.execute`.

### 3.5 Implement `TrajectoryRecorder` (45 min)

- [ ] `packages/agent-runtime/src/trajectory/trajectory-recorder.ts` — as per §2.4.
- [ ] Update `ReActLoop` constructor to accept `recorder: TrajectoryRecorder` (optional, nullable for unit tests).
- [ ] Call `await recorder.record(agentRunId, step)` after each step in the loop.

### 3.6 Implement `ArtifactCaptureSubscriber` (60 min)

- [ ] `packages/artifact-tracker/src/capture/artifact-capture-subscriber.ts`:

```typescript
export class ArtifactCaptureSubscriber {
  constructor(private readonly db: DrizzleDB) {}

  subscribe(bus: IEventBus): void {
    bus.subscribe('artifact.created', async (event) => {
      const p = event.payload;
      await this.db.insert(artifacts).values({
        id:           uuidv7(),
        agent_run_id: p.agent_run_id,
        file_path:    p.file_path,
        content_hash: p.content_hash,
        size_bytes:   p.size_bytes,
        status:       'PENDING',
      }).onConflictDoNothing();
    });
  }
}
```

- [ ] Wire subscriber in `apps/api/src/bootstrap.ts`.

### 3.7 Wire tools in DI (30 min)

- [ ] `apps/api/src/bootstrap.ts`:

```typescript
c.register(TOKENS.ToolRegistry, (c) => {
  const sandbox = process.env.SANDBOX_ROOT ?? './sandbox';
  const allowed = new Set((process.env.AGENT_ALLOWED_TOOLS ?? 'read_file,write_file,list_directory').split(','));
  const allowlist = new ToolAllowlist(allowed);
  const registry = new ToolRegistry(allowlist, c.resolve(TOKENS.EventBus));
  registry.register(makeReadFileTool(sandbox));
  registry.register(makeWriteFileTool(sandbox));
  registry.register(makeListDirectoryTool(sandbox));
  return registry;
});
```

- [ ] Add `TOKENS.TrajectoryRecorder` and register it.
- [ ] Update `docs/architecture/wiring-map.md`.

### 3.8 Tests (150 min)

File: `packages/agent-runtime/src/__tests__/resolve-safe.test.ts`
- [ ] Valid path resolves correctly.
- [ ] `../` traversal throws.
- [ ] Absolute path outside root throws.

File: `packages/agent-runtime/src/__tests__/file-tools.test.ts`
- [ ] `write_file` creates a file with correct content.
- [ ] `read_file` returns written content.
- [ ] `list_directory` lists written files.
- [ ] `write_file` creates nested parent directories.

File: `packages/agent-runtime/src/__tests__/tool-allowlist.test.ts`
- [ ] Allowed tool executes without error.
- [ ] Disallowed tool throws `TOOL_NOT_ALLOWED`.

File: `packages/agent-runtime/src/__tests__/trajectory-recorder.test.ts`
- [ ] Records a step with tool call correctly.
- [ ] Records a step without tool call (final answer) correctly.
- [ ] Nullable fields are stored as `null`, not `undefined`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/trajectory-steps.ts` | Trajectory table |
| `packages/db/migrations/0007_*.sql` | Migration |
| `packages/agent-runtime/src/tools/resolve-safe.ts` | Path safety utility |
| `packages/agent-runtime/src/tools/file-tools.ts` | `read_file`, `write_file`, `list_directory` |
| `packages/agent-runtime/src/tools/tool-allowlist.ts` | `ToolAllowlist` |
| `packages/agent-runtime/src/tools/tool-registry.ts` (updated) | Allowlist integration |
| `packages/agent-runtime/src/trajectory/trajectory-recorder.ts` | `TrajectoryRecorder` |
| `packages/agent-runtime/src/react/react-loop.ts` (updated) | Recorder injection |
| `packages/artifact-tracker/src/capture/artifact-capture-subscriber.ts` | Artifact capture |
| `apps/api/src/bootstrap.ts` (updated) | Tool + subscriber wiring |
| 4 test files | Unit tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/agent-runtime test` — all tests pass.
- [ ] `pnpm --filter @harness/artifact-tracker test` — all tests pass.
- [ ] `pnpm lint` — zero boundary violations.
- [ ] `trajectory_steps` table exists.
- [ ] Path traversal attempts are rejected with `PATH_TRAVERSAL_REJECTED`.
- [ ] Disallowed tools throw `TOOL_NOT_ALLOWED`.
- [ ] `artifact.created` event results in an `artifacts` row with `status = 'PENDING'`.
- [ ] `docs/architecture/wiring-map.md` updated.

---

## 6. Notes & Pitfalls

- **`SANDBOX_ROOT` must exist before tools run.** Add `mkdirSync(sandboxRoot, { recursive: true })` to `bootstrap.ts` on startup.
- **`write_file` emitting `artifact.created` is fire-and-forget.** The tool does not await the subscriber. The bus is synchronous (EventEmitter) so the subscriber runs before `publish` returns — but the subscriber's DB insert is async and unawaited (`.catch` logged). This is intentional.
- **Do not add a `run_command` tool today.** Arbitrary shell execution requires sandboxing (Phase 2). `read_file` / `write_file` / `list_directory` are sufficient for the Week 2 demo.
- **`thought` may be an empty string** when the model immediately calls a tool without reasoning text. Store it as-is; do not coerce to `null` — the distinction matters for debugging.
- **`tool_input` is `jsonb`.** Do not serialise it to a string before inserting; Drizzle handles `jsonb` natively.
- **Tomorrow (Day 14):** Artifact Tracker Phase 1 — full `Artifact`/`Change`/`Snapshot` lifecycle, content-addressed storage, and the Week 2 integration checkpoint.

---

*Prev: [Day 12 — ReAct Loop](day-12.md) | Next: [Day 14 — Artifact Tracker Phase 1 & Week 2 Checkpoint](day-14.md)*
