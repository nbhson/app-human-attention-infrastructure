# @harness/agent-runtime — AI Agent Runtime

The execution environment where agents live and work: the LLM-provider seam, the
tool registry + allowlist, the ReAct loop, trajectory recording, and the
sandboxed Code-Mode tier stack.

**Status:** Phase 1 + Code Mode (Phase 2) complete (as-built) ·
**Boundary rule:** engine — imports only shared packages.

---

## Purpose

1. **Receive a Task** — accept an `AgentExecutionRequest` (task + pre-processed context) from the orchestrator.
2. **Initialize an agent** — instantiate a profile by `AgentType`.
3. **Run the loop** — think → tool-call → observe, bounded by `maxSteps` and a token budget.
4. **Call tools through the allowlist** — nothing runs that isn't in `allowedTools`.
5. **Record the trajectory** — append-only, fully re-playable evidence of every step.
6. **Return a result** — terminal `AgentExecutionStatus` + `artifactsChanged`.

> **Core principle:** evidence before confidence — "here is the evidence", not
> "the AI says it's correct". Without a detailed trajectory an agent is not
> useful in a professional setting.

---

## Execution model

```text
┌─────────────┐         ┌──────────────────────────────┐         ┌─────────────┐
│ Orchestrator│───────▶ │         Agent Runtime        │         │ Trajectory  │
│  (VERIFY    │  Agent   │ 1. Load agent (AgentType)   │─every──▶ │ (append-only│
│   step)     │Execution │ 2. Inject context           │  step    │  evidence)  │
└─────────────┘ Request  │ 3. Run the ReAct loop        │         └─────────────┘
                         │ 4. Return terminal status    │
                         └──────────────────────────────┘
```

---

## Agent run lifecycle

The run's own state machine (`AgentRunStatus`), distinct from the terminal
`AgentExecutionStatus` reported back to the orchestrator:

```text
 INITIALIZED ──▶ PLANNING ──▶ EXECUTING ──┐
                                          │  (loop: TOOL_CALLING ⇄ OBSERVING)
                                          ▼
                                       FINALIZING
                                          │
              ┌───────────────────────────┼───────────────────┐
              ▼                           ▼                   ▼
          COMPLETED                ESCALATED / FAILED      CANCELLED / ERROR
```

- `ESCALATED` (with `escalation_reason = MAX_STEPS_EXCEEDED` or
  `TOKEN_BUDGET_EXCEEDED`) is the soft ceiling — the run is handed to human
  attention, and the failure classifies as `FailureClass.RESOURCE`.
- The **terminal** `AgentExecutionStatus` is `SUCCESS | FAILED | CANCELLED | PARTIAL`.

---

## Agent profiles

The runtime can instantiate any of these; Phase 1 exercises `CODING_AGENT`:

| Agent type | Common tools |
| --- | --- |
| `CODING_AGENT` | `read_file`, `write_file`, `git_diff` |
| `TESTING_AGENT` | `read_file`, `write_file`, `run_test` |
| `REVIEW_AGENT` | `read_file`, `git_log` |
| `DOCUMENTATION_AGENT` | `read_file`, `write_file` |
| `ARCHITECTURE_AGENT` | `read_file`, `analyze_metrics` |

---

## Tool calling

- Tools are defined as function schemas; an agent can call **only** names present in the request's `allowedTools`.
- Permission is enforced by `tool-registry.ts` + `tool-allowlist.ts` — a call outside the list is rejected, not silently dropped.
- Code-Mode tools are **sandboxed**: `code-mode/sandboxed-tools.ts` routes execution through `TOKENS.Sandbox`; `code-mode/tiers.ts` gates capability tiers; `code-mode/rate-limiter.ts` applies per-tool sliding windows.

---

## Trajectory — the key to everything

```text
AgentRun
├── id / taskId / agentType / modelUsed
├── status
├── startTimestamp / endTimestamp
├── totalTokensUsed
├── steps: TrajectoryStep[]          # append-only, replayable
│   ├── { type: "THOUGHT",     content, modelUsed?, promptHash? }
│   ├── { type: "TOOL_CALL",   toolName, toolInput, toolOutput? }
│   └── { type: "OBSERVATION", content }
├── finalOutput?
├── artifactsChanged: string[]       # relative paths written
└── forkedFrom?: { runId, stepIndex }
```

Every step carries a `stepIndex`; the stream is deterministic-by-default
(`toolInput` + `toolOutput` + `modelUsed`/`promptHash`), so replay needs no
external calls. This is what makes the evaluation package's trajectory replayer
faithful.

---

## Modules

| Module | What it provides |
| --- | --- |
| `llm/llm-provider.ts` | The provider seam (`LlmsProvider` / `ChatPrompt`). |
| `llm/anthropic-provider.ts` | Real Anthropic provider (compile-tested; no live keys in-repo). |
| `llm/mock-llm.ts` | Deterministic mock — the DI default. |
| `llm/logging-provider.ts` | Captures prompts to evidence without calling a model. |
| `llm/map-anthropic-response.ts` | Anthropic response → normalized `AgentResponse`. |
| `llm/token-budget.ts` | `budget()` / `TokenBudget` / `exceedsBudget`. |
| `tools/tool-registry.ts` | Tool registration + dispatch. |
| `tools/tool-allowlist.ts` | Per-request allowlist enforcement. |
| `tools/file-tools.ts` | `read_file` / `write_file` handlers. |
| `tools/resolve-safe.ts` | Path resolution that never escapes the workdir. |
| `react/react-loop.ts` | The think → tool → observe loop. |
| `runner/agent-runner.ts` | `AgentRunner` — invoke with budget + variant. |
| `runner/runtime-poll-loop.ts` | Runtime polling for long-running agents. |
| `trajectory/trajectory-recorder.ts` | Deterministic trajectory capture. |
| `code-mode/sandboxed-tools.ts` | Sandbox-routed tools. |
| `code-mode/tiers.ts` | Code-mode capability tiers. |
| `code-mode/rate-limiter.ts` | Per-tool sliding-window rate limits. |
| `code-mode/code-mode-session.ts` | `code_mode_sessions` state. |

---

## Interaction with other packages

```text
                    ┌──────────────────────────┐
                    │      agent-runtime       │
                    └───────────┬──────────────┘
                                │  (never imports another engine)
      ┌──────────┬──────────────┼───────────────┬────────────┐
      ▼          ▼              ▼               ▼            ▼
  @harness/  @harness/     @harness/       @harness/    @harness/
  domain      event-bus       db              di         sandbox (seam)
```

The runtime **does not** run verification or compute attention — it only emits
events (`task.execution_finished`, `artifact.changed`) and returns its result to
the orchestrator, which triggers the next engines. It resolves `TOKENS.Sandbox`
for code-mode, never importing the concrete `DockerSandbox`.

---

## Key invariants

- **Budgets are hard.** `maxSteps` (default `DEFAULT_MAX_STEPS = 10`) and the
  token budget (`DEFAULT_TOKEN_BUDGET = 50_000`) are ceilings, not advice;
  exceeding either escalates to `AWAITING_HUMAN_INTERVENTION`.
- **Determinism for replay.** The recorder captures exactly what the agent saw
  and did, so a run can be re-materialized byte-for-byte.
- **No secrets, no host FS.** Code-mode tools run through the sandbox; file
  tools resolve paths inside the workdir only.

---

## Directory structure

```
src/
├── index.ts
├── llm/               # provider seam + anthropic + mock + logging + budget
├── tools/            # registry, allowlist, file tools, resolve-safe
├── react/            # react-loop
├── runner/           # agent-runner, runtime-poll-loop
├── trajectory/       # trajectory-recorder
└── code-mode/        # sandboxed-tools, tiers, rate-limiter, code-mode-session
```

## Public API surface

```typescript
// domain-backed (re-exported) types: AgentType, AgentRunStatus,
// AgentExecutionStatus, ModelProvider, ModelConfig, TrajectoryStep, AgentRun,
// AgentExecutionRequest, createAgentExecutionRequest, DEFAULT_MAX_STEPS
// runtime:
//   AgentRunner, the ReAct loop, TokenBudget/budget/exceedsBudget,
//   the LlmsProvider seam + AnthropicProvider + MockLLM + LoggingProvider,
//   ToolRegistry, ToolAllowlist, FileTools, resolveSafe,
//   trajectory recorder, CodeMode session/tiers/rate-limiter/sandboxed-tools
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`; the default `LlmsProvider` is the mock
(flipped to `anthropic` by env). The runtime is invoked by the orchestrator and
verification engine through shared seams, not by importing those packages.