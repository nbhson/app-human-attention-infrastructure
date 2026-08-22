# AI Agent Runtime
## Specification v0.3 – Running and Coordinating AI Agents

**Status:** Draft v0.3  
**Dependencies:** Architecture (`1_HAI_Harness_Architecture_v0.2.md`), Task Orchestrator (`2_Task_Work_Orchestrator_v0.3.md`)  
**Purpose:** Define how the Harness initializes, executes, monitors, and records AI Agent activities when performing a specific `Task`.

---

# 1. Purpose

The `AI Agent Runtime` is the execution environment (sandbox) where Agents live and work.

Its core responsibilities:
1.  **Receive Task:** Accept a `Task` scheduled by the `Orchestrator` along with pre-processed context (Context).
2.  **Initialize Agent:** Create a specific Agent instance (CodeAgent, TestAgent, ReviewAgent...) based on requirements.
3.  **Execute Loop (ReAct Loop):** Control the Agent to think (Think), call tools (Act/Tool Call), observe results (Observe) until task completion.
4.  **Tool/MCP Interaction:** Allow Agents to use Git, File System, CI/CD, Jira, or any external tool via MCP protocol or Function Calling.
5.  **Record Trajectory:** Log **every step** (Thought, Tool Call, Tool Output) to provide evidence for other systems.
6.  **Return Result:** Package the result (Artifact – code, test, docs) and final status (Success / Failure) back to the `Orchestrator`.

> **Core Principle:** Evidence before confidence — "Here is the evidence" not "AI says it is correct". The Runtime must be fully transparent. Without a detailed `Trajectory`, the Agent is not truly useful for professional software development environments.

---

# 2. Execution Model: Task → Agent → Trajectory

```text
┌─────────────┐       ┌─────────────────────┐       ┌─────────────────┐
│ Orches-     │──────▶│   AI Agent Runtime  │──────▶│   Trajectory    │
│ trator      │       │                     │       │   (Evidence)    │
└─────────────┘       │ 1. Load Agent       │       └─────────────────┘
                       │ 2. Inject Context   │
                       │ 3. Execute Loop     │
                       │ 4. Return Result    │
                       └─────────────────────┘
```

**Input:**

- TaskID and Task Definition
- Context (processed by Context Engine)
- AgentType (e.g., "CodingAgent", "TestingAgent")
- Model Config (which model, temperature)
- Tools Available (list of permitted tools)

**Output:**

- Artifacts: Files created or modified
- Trajectory: History of thoughts and actions
- FinalStatus: SUCCESS, FAILED, PARTIAL
- Error Logs: Errors encountered (if any)

---

# 3. Agent Run Lifecycle

Each time the Runtime executes a Task, it goes through the following states:

```text
                     ┌─────────────┐
                     │  INITIALIZED│ (Runtime receives Task and Context)
                     └──────┬──────┘
                            │
                            ▼
                     ┌─────────────┐
                     │  PLANNING   │ (Agent thinks about strategy)
                     └──────┬──────┘
                            │
                            ▼
          ┌─────────────────────────────────┐
          │         EXECUTING LOOP          │◄──────┐
          │  (Think -> Tool Call -> Observe)│       │
          └────────────────┬────────────────┘       │
                           │                        │
                  ┌────────┴─────────┐              │
                  │  TOOL_CALLING    │              │
                  │  (Agent calls    │              │
                  │   Git, File, LLM)│              │
                  └────────┬─────────┘              │
                           │                        │
                  ┌────────┴─────────┐              │
                  │   OBSERVING      │──────────────┘
                  │ (Receives tool   │ (If more actions needed)
                  │  output)         │
                  └────────┬─────────┘
                           │ Agent decides to stop
                           ▼
                    ┌─────────────┐
                    │ FINALIZING  │ (Compile final output)
                    └──────┬──────┘
                           │
                ┌──────────┴──────────┐
                │                     │
             SUCCESS               FAILED
                │                     │
                ▼                     ▼
        ┌─────────────┐     ┌─────────────────┐
        │  COMPLETED  │     │   ERROR / STOP  │
        └─────────────┘     └─────────────────┘
```

---

# 4. Agent Types

While the Runtime can execute any Agent, we should define standard "profiles" for the Orchestrator to easily invoke:

| Agent Type | Description | Common Tools |
|------------|-------------|--------------|
| **CodingAgent** | Write code, fix bugs, refactor | read_file, write_file, search_code, git_diff |
| **TestingAgent** | Create unit tests, integration tests | read_file, write_file, run_test (read results) |
| **ReviewAgent** | Code review, find potential bugs, suggest improvements | read_file, search_symbol, git_log |
| **DocumentationAgent** | Write/update docs, README, Javadoc | read_file, write_file, search |
| **ArchitectureAgent** | Analyze architecture, suggest new modules | read_file, visualize_dependency, analyze_metrics |

**Note:** We will start with only one type (e.g., CodingAgent) in Phase 1, then expand.

---

# 5. Tool Calling / MCP Integration

This is the most important part for Agents to interact with the real world.

**Design Principles:**

- The Runtime does not arbitrarily run dangerous shell commands.
- All Tools are defined as Function Schemas (similar to OpenAI Function Calling).
- Agents can only call Tools in the `allowed_tools` list of the Task.

**Example Tool Schema (JSON):**

```json
{
  "name": "read_file",
  "description": "Read the content of a file in the repository",
  "parameters": {
    "type": "object",
    "properties": {
      "file_path": {
        "type": "string",
        "description": "Relative path to the file"
      },
      "line_start": { "type": "integer", "description": "Starting line" },
      "line_end": { "type": "integer", "description": "Ending line" }
    },
    "required": ["file_path"]
  }
}
```

**Tool Calling Process in Runtime:**

1. LLM returns `tool_calls`.
2. Runtime extracts the tool name and parameters.
3. Runtime finds the corresponding ToolHandler in the system.
4. ToolHandler executes (e.g., read file from Git, call CI API...).
5. Runtime receives the result (or error) and sends it back to LLM as an "observation".
6. LLM continues looping (or stops if done).

---

# 6. Trajectory – The Key to Everything

Per the Architecture requirement (Section 8), Trajectory is mandatory, not an add-on.

Each AgentRun must produce a Trajectory object with the following structure:

```text
AgentRunTrajectory
├── run_id: string
├── task_id: string
├── agent_type: string
├── model_used: string (e.g., "claude-3.5-sonnet")
├── start_timestamp: ISO8601
├── end_timestamp: ISO8601
├── total_tokens_used: int
├── steps: List[Step]
│   ├── Step #1
│   │   ├── type: "THOUGHT"
│   │   └── content: "I need to find the payment handler..."
│   ├── Step #2
│   │   ├── type: "TOOL_CALL"
│   │   ├── tool_name: "read_file"
│   │   ├── tool_input: { "file_path": "src/payment.ts" }
│   │   └── tool_output: "export class PaymentService { ... }"
│   ├── Step #3
│   │   ├── type: "THOUGHT"
│   │   └── content: "Now I will fix the bug here..."
│   └── Step #4
│       ├── type: "TOOL_CALL"
│       ├── tool_name: "write_file"
│       ├── tool_input: { "file_path": "src/payment.ts", "content": "..." }
│       └── tool_output: "File updated successfully."
├── final_output: "Bug fixed in PaymentService."
└── artifacts_changed: ["src/payment.ts", "test/payment.test.ts"]
```

**Why is Trajectory important?**

- **For Observability:** Dev/Manager can see what the Agent "thought".
- **For Memory:** The Memory System can store successful "patterns" for future use.
- **For Auditing:** If the Agent makes a mistake, we know exactly which file it read and wrote at each step.

## 6.1 Trajectory Operations — Fork, Replay, Resume (Phase 2/3 seam)

Phase 1 only *records* the trajectory. The same immutable event stream is the raw
material for four higher-value operations, each of which becomes a product feature in
later phases. These are defined here (not in Phase 1) so the record format commits to
being a **complete, replayable event stream** from day one.

| Operation | Definition | Consumes | Phase |
|-----------|------------|----------|-------|
| **Replay** | Re-materialize any past run step-by-step from the stored `steps[]` | Trajectory (append-only) | 2 — A/B harness (Spec 11), debugging |
| **Fork** | Branch an existing run at step *k*, then re-execute with a different model / prompt / context and compare outcomes | Trajectory + `forked_from: { runId, stepIndex }` | 3 — head-to-head agent tuning |
| **Resume** | Continue an interrupted run from its last committed step instead of restarting | Trajectory + durable step commits | 3 — crash recovery, long tasks |
| **Event Search** | Query runs by `run_id`, `task_id`, tool name, or a step's output substring | `steps[]` indexed on store | 2 — audit ("which run wrote X?") |

Design implications that Phase 1 commits to even though the operations ship later:

- Every step is **deterministic-by-default**: store `tool_input` + `tool_output` + the
  step's `model_used`/`prompt_hash` so a replay needs no external calls to reproduce.
- Step writes are **idempotent and append-ordered** (step index + run-scoped monotonic
  counter). This is what makes Fork safe: forking never mutates the parent run.
- A `forked_from` reference is a first-class field on `AgentRunTrajectory`, not a log
  note — the provenance chain stays queryable across forks.

> Relationship to the Event Sourcing pattern in Spec 9: the trajectory is an
> event-sourced entity. Every mutation is an append; "current state" is a replay of the
> stream. This is why we never store a mutated trajectory blob.

---

# 7. Interaction with Other Subsystems

```text
                     ┌─────────────────────────┐
                     │  AI Agent Runtime       │
                     └───────────┬─────────────┘
                                 │
      ┌──────────────────────────┼───────────────────────────┐
      │                          │                           │
      ▼                          ▼                           ▼
┌─────────────┐       ┌──────────────────┐       ┌──────────────────┐
│   Context   │       │     Memory       │       │  Artifact /      │
│   Engine    │       │   (store trajectory)│     │  Change Tracker  │
│ (Fetch context)│     └──────────────────┘       │ (Report file     │
└─────────────┘                                   │  changes)        │
                                                   └──────────────────┘
      │                          │                           │
      ▼                          ▼                           ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│ Verification     │       │   Attention      │       │  Evidence /      │
│   Engine         │◄──────│   Engine         │──────►│  Memory System   │
│ (Validate code)  │       │ (Assess risk)    │       │  (Long-term      │
└──────────────────┘       └──────────────────┘       │  storage)        │
                                                      └──────────────────┘
```

**With Context Engine:** Runtime requests "I am Agent X, provide context for Task Y". Never force-inject context.

**With Task Orchestrator:** Report status (running, completed, error...). Receive cancel command if Orchestrator decides to timeout.

**With Verification Engine:** After Agent completes, the Orchestrator calls the Verification Engine. The Agent does not run verification itself — that is the Verification Engine's responsibility.

**With Attention Engine:** The Runtime does **not** call the Attention Engine directly. It only emits events (`TaskExecutionFinished`, `ArtifactChanged`) and returns its result to the Orchestrator. The Orchestrator then triggers the Attention Engine (after verification) with the change ID. This keeps the dependency direction pointing inward and keeps the Runtime free of workflow knowledge.

**With Artifact / Change Tracker:** Every time the Agent writes a file, Runtime must emit an ArtifactCreated/ArtifactChanged event to the Tracker.

**With Memory / Evidence:** After completion, the entire Trajectory is sent to the Memory System for long-term storage and learning from previous decisions.

---

# 8. Internal Architecture of the Runtime

To maintain the Modular Monolith spirit, the Runtime is divided into 5 layers:

```text
┌──────────────────────────────────────────────────────┐
│              AI AGENT RUNTIME MODULE                 │
├──────────────────────────────────────────────────────┤
│ 1. Agent Factory                                    │
│    - Initialize Agent based on AgentType.            │
│    - Inject System Prompts and Tool definitions.     │
│                                                      │
│ 2. LLM Gateway (Adapter)                            │
│    - Abstract various LLM providers.                 │
│    - Handle retry, fallback, token counting.         │
│    - Interface: `LLMProvider` (OpenAI, Anthropic..) │
│                                                      │
│ 3. Tool Registry & Executor                         │
│    - Register all Tool Handlers.                     │
│    - Permission check (allowlist).                   │
│    - Execute Tools and catch errors.                 │
│                                                      │
│ 4. Trajectory Recorder                              │
│    - Listen to all events (Thought, ToolCall).       │
│    - Log to temporary memory (In-Memory) during      │
│      execution.                                      │
│    - Flush to Database/Event Bus on completion.      │
│                                                      │
│ 5. Evidence Collector                               │
│    - Collect *execution* evidence only:              │
│      - Tool call inputs/outputs                     │
│      - Files read during the run                    │
│      - Agent's stated reasoning per step            │
│    - NOT verification evidence (tests, compile,     │
│      lint, security scans) — that is produced       │
│      independently by the Verification Engine.      │
│    - Link claims → execution evidence               │
└──────────────────────────────────────────────────────┘
```

---

# 9. Phase 1 – Minimum Viable Plan

Following the "Vertical Slice" spirit of the Architecture, we will NOT build a complex ReAct loop from day one.

**Phase 1: "Single-Turn Generation"**

- Runtime only receives the Task, calls LLM once (no complex tool calling loop).
- Allow the Agent to use only 1 tool: `read_file`.
- No multi-step processing (Agent doesn't auto-fix code; only generates text and returns).
- Trajectory consists of only 1 Thought + 1 Final Output.
- **Goal:** Prove that calling LLM with Context and returning structured results works.

**Phase 2: "Basic ReAct Loop"**

- Allow Agent to call up to 3 loops (Think -> Tool -> Observe).
- Expand tools: `read_file`, `search_code`.
- Add stop mechanism: If Agent decides "FINAL_ANSWER", stop.

**Phase 3: "Full Agent Capability"**

- Full support for OpenAI/Anthropic Function Calling.
- Integrate MCP (Model Context Protocol) for external tools.
- Allow Agent to write files (`write_file`, `patch_file`).
- Full Trajectory recording with rich Step types.

---

# 10. Success Criteria

The Runtime is considered Phase 1 complete when:

- Successfully call an LLM (e.g., Claude) with System Prompt + User Prompt and receive text response.
- Runtime can parse and successfully execute the `read_file` tool to get real file content from the repository.
- After execution, Runtime outputs a valid Trajectory object (with run_id, steps, final_output).
- Runtime reports clear errors if LLM returns invalid JSON format or Tool doesn't exist (doesn't hang).

---

# 11. API Surface (Internal)

```typescript
interface IAgentRuntime {
  // Orchestrator calls this to run an Agent
  executeTask(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
  
  // Call to emergency stop agent (on timeout)
  cancelRun(runId: string): Promise<void>;
}

interface AgentExecutionRequest {
  taskId: string;
  agentType: "CodingAgent" | "TestingAgent" | "ReviewAgent";
  context: string; // Context processed by Context Engine
  modelConfig: {
    provider: "openai" | "anthropic" | "gemini";
    model: string;
    temperature: number;
    maxTokens: number;
  };
  allowedTools: string[]; // List of permitted tools
  instructions: string; // Specific task requirements
  maxSteps?: number; // Max Think→Act→Observe loops before auto-fail (default: 10, see Section 14)
}

interface AgentExecutionResult {
  runId: string;
  status: "SUCCESS" | "FAILED" | "CANCELLED";
  trajectory: Trajectory;
  artifacts: ArtifactChange[];
  finalMessage: string;
  error?: string;
}
```

---

# 12. Expected Directory Structure

In `packages/agent-runtime/src/`:

```text
agent-runtime/
├── src/
│   ├── factory/
│   │   └── AgentFactory.ts      # Create Agent by type
│   ├── core/
│   │   ├── AgentExecutor.ts     # Main loop
│   │   └── ReActLoop.ts         # Think -> Act -> Observe logic
│   ├── llm/
│   │   ├── LLMProvider.ts       # Interface
│   │   ├── OpenAIAdapter.ts
│   │   └── AnthropicAdapter.ts
│   ├── tools/
│   │   ├── ToolRegistry.ts
│   │   ├── handlers/
│   │   │   ├── ReadFileHandler.ts
│   │   │   ├── WriteFileHandler.ts
│   │   │   └── SearchCodeHandler.ts
│   │   └── MCPAdapter.ts        # (Phase 3)
│   ├── trajectory/
│   │   ├── TrajectoryRecorder.ts
│   │   └── TrajectoryTypes.ts
│   └── index.ts
└── package.json
```

---

# 13. Concrete Next Steps

Follow this order to avoid being overwhelmed:

- [ ] Step 1: Define basic TypeScript interfaces (AgentExecutionRequest, Trajectory, ToolCall).
- [ ] Step 2: Write simple LLMProvider adapter for OpenAI (basic ChatCompletion API call only).
- [ ] Step 3: Write ToolRegistry and ReadFileHandler (simulate reading file from local directory).
- [ ] Step 4: Write Single-Turn AgentExecutor (no loop) - call LLM, if LLM requests `read_file` tool, execute and return result once.
- [ ] Step 5: Write simple TrajectoryRecorder logging to temporary JSON file for debugging.
- [ ] Step 6: Write unit test covering the flow: "Agent receives context -> calls read_file tool -> returns result".
- [ ] Step 7: Temporary integration with Task Orchestrator (call executeTask function).

---

# 14. Important Security & Cost Considerations

**Sandbox:** In Phase 1, Runtime runs in the same process as the Monolith. From Phase 2, consider running Agents in a separate Container or Worker to prevent Agents from reading sensitive system files.

**Token Costs:** Trajectory logs everything and will consume significant memory. Two hard ceilings bound a run, both configurable by env and both escalating the run to `AWAITING_HUMAN_INTERVENTION` when exceeded:

- **Max steps** — `AGENT_MAX_STEPS`, default **10** (also the `AgentExecutionRequest.maxSteps` default). Exceeded → `agent_runs` status `ESCALATED` with `escalation_reason = MAX_STEPS_EXCEEDED`.
- **Token budget** — per-run token ceiling, `DEFAULT_TOKEN_BUDGET = 50_000`. Exceeded → `escalation_reason = TOKEN_BUDGET_EXCEEDED`.

Both escalation reasons are classified as `FailureClass.RESOURCE` by the Orchestrator's failure taxonomy (see Orchestrator §7): a quota/capacity limit, retried only after a cooldown — never as a `PERMANENT` logic failure.

**Hallucination:** Runtime does not evaluate code quality (that is the Verification Engine's job). Runtime only validates whether the Agent called the correct Tool.

## 14.1 Tool permission tiers (Phase 2+)

Phase 1 uses a flat `allowedTools` allowlist. The reference framework escalates this to
**RBAC tiers**, which the Runtime adopts once tool count grows:

| Tier | Examples | Policy |
|------|----------|--------|
| `public` | `read_file`, `search_code`, `git_log` | Any agent, no extra gate |
| `standard` | `write_file`, `patch_file`, `run_test` | Allowlist, logged per call |
| `elevated` | `git_push`, `npm_publish`, `modify_ci` | Requires human-scoped approval gate (orchestrator flag) |
| `admin` | `delete_branch`, `rotate_secret` | Disabled for agents by default; human-only |

- A tool's tier is a property of the tool registry entry, not a per-call guess by the agent.
- Tier escalation is enforced by the **Runtime**, verified by the **Trajectory** (the
  `TOOL_CALL` step records the tier), and auditable via the Evidence System (9).

## 14.2 Tool rate limiting (Phase 2+)

A runaway ReAct loop can exhaust budget or hammer an external API. The Runtime applies a
**sliding window** per tool (e.g. `run_test` ≤ 10 / minute; `write_file` ≤ 50 / run):
exceeding the window returns a structured rate-limit observation to the LLM (so it can
change strategy) rather than a silent drop, and repeated violations are a
failure signal to the Orchestrator (2).

## 14.3 Code-mode sandbox (Phase 2+)

The reference framework's "Code Mode" (a vm-sandboxed, high-token-density execution mode
with batched tools) is the model for the Phase-2 sandbox upgrade in this spec's
"Sandbox" note: untrusted agent execution moves from in-process to an isolated worktree
or container, with tool calls batched against the sandbox instead of leaked into the host
process. This is the *same* isolation boundary as Verification §5.5 — the Runtime and the
Verification Engine share one sandbox abstraction so verification is genuinely
independent of generation, not just a different call site.

---

## Changelog

### v0.3 (Day 28)
- (Day 8): §6.1 — trajectory operations (fork, replay, resume).
- (Day 23): §14.3 — code-mode sandbox (`--network none` container, append-only `code_mode_sessions` evidence).
### v0.2
- §11 — `maxSteps` default confirmed as **10** (`AGENT_MAX_STEPS` /
  `DEFAULT_MAX_STEPS`), and `DEFAULT_TOKEN_BUDGET = 50_000` documented.
- §14 — documented the two escalation reasons (`MAX_STEPS_EXCEEDED`,
  `TOKEN_BUDGET_EXCEEDED`) and that both classify as `FailureClass.RESOURCE`
  (cooldown retry) in the shared failure taxonomy — a v0.1 ambiguity.
- No code divergences found: the ReAct loop, `TokenBudget`, trajectory recording,
  and escalation behavior match this spec as built.