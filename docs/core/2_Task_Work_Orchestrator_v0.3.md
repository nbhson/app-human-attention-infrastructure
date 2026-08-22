# Task / Work Orchestrator
## Specification v0.3 – Managing Tasks and Workflows

**Status:** Draft v0.3  
**Dependency:** Architecture Specification (`HAI_Harness_Architecture_v0.2.md`)  
**Purpose:** Define the core orchestration engine responsible for breaking down high-level goals into executable tasks, managing their lifecycle, handling dependencies, and ensuring reliable end-to-end execution flow.

---

# 1. Purpose

The **Task / Work Orchestrator** is the "brain" that converts a developer's request (or a system trigger) into a structured, executable plan.

Its primary responsibilities are:
1.  **Decomposition:** Breaking down complex requirements (e.g., "Implement feature X") into smaller, atomic `Tasks`.
2.  **Workflow Management:** Defining the execution order (Sequential, Parallel, Conditional, or DAG-based).
3.  **Lifecycle Management:** Tracking the state of each Task from creation to completion.
4.  **Dispatching:** Assigning Tasks to the appropriate `AI Agent Runtime` or internal handlers.
5.  **Resilience:** Handling failures, retries, and rollbacks.
6.  **External Coordination:** Acting as the central nervous system that triggers the `Verification Engine`, `Attention Engine`, and `Memory System` at the right moments.

> **Core Principle:** The Orchestrator owns the *"What"* and *"When"*. The `Agent Runtime` owns the *"How"* (the actual execution logic).

---

# 2. Core Domain Objects

Before diving into logic, we define the fundamental entities.

## 2.1 Workflow
A `Workflow` is a container for a collection of `Tasks` that achieve a single business goal (e.g., "Fix security vulnerability", "Add new API endpoint").

```text
Workflow
├── id: WorkflowID
├── name: string
├── description: string
├── status: WorkflowStatus
├── created_by: Human | System
├── context_ref: ContextID (reference to Context Engine snapshot)
├── tasks: List[TaskID]
├── dependencies: DAG (Directed Acyclic Graph)
├── policy: WorkflowPolicy (retry, timeout, concurrency)
└── metadata: Map[string, any]
```

## 2.2 Task
A Task is the smallest indivisible unit of work that the Orchestrator manages. It cannot be broken down further by the Orchestrator (though the Agent might split it internally).

> **Core Principle:** Evidence before confidence — a Task must carry evidence proving its outcome, not merely the AI's claim of success.

```text
Task
├── id: TaskID
├── workflow_id: WorkflowID
├── name: string
├── description: string
├── requirements: string (requirements from the developer)
├── context: ContextRef (Reference to Context Engine snapshot)
├── status: TaskStatus
├── owner: Human | System
├── agents: List[AgentType]
├── artifacts: List[ArtifactID]
├── evidence: List[EvidenceID] (Test results, compiler output, analysis)
├── decisions: List[Decision] (Human decisions recorded)
├── outcome: string
├── input_schema: JSON Schema (expected input)
├── output_schema: JSON Schema (expected output)
├── priority: Priority (CRITICAL, HIGH, MEDIUM, LOW)
├── depends_on: List[TaskID] (Blocking dependencies)
├── retry_count: int
├── max_retries: int
├── timeout_seconds: int
├── created_at: timestamp
├── started_at: timestamp
├── completed_at: timestamp
└── result_ref: EvidenceID (Link to stored evidence/output)
```

## 2.3 Workflow Policy
Defines the runtime behavior of the workflow.

```text
WorkflowPolicy
├── allow_parallel: boolean
├── max_concurrent_tasks: int
├── failure_strategy: FAIL_FAST | CONTINUE | ROLLBACK
├── retry_policy: ExponentialBackoff | FixedInterval
└── approval_gate: boolean (Require human approval before execution?)
```

# 3. Task Lifecycle (States)
The Orchestrator relies on a strict state machine for each Task.

```text
                    ┌─────────────┐
                    │   PENDING   │ (Initial state, waiting for dependencies)
                    └──────┬──────┘
                           │ Dependencies resolved
                           ▼
                    ┌─────────────┐
                    │   QUEUED    │ (Ready to execute, waiting for agent capacity)
                    └──────┬──────┘
                           │ Agent Runtime picks up
                           ▼
                    ┌─────────────┐
                    │  EXECUTING  │ (Agent is actively working)
                    └──────┬──────┘
                           │ Agent finishes
                           ▼
                    ┌─────────────┐
                    │  VERIFYING  │ (Triggering Verification Engine)
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
           PASSED                    FAILED
              │                         │
              ▼                         ▼
    ┌─────────────────┐      ┌─────────────────┐
    │ AWAITING_REVIEW │      │    FAILED       │◄────┐
    │ (Attention Eng) │      └────────┬────────┘     │
    └────────┬────────┘               │              │
             │ Human Decision         │ Retry?       │
    ┌────────┴────────┐       ┌───────┴───────┐      │
    │                 │       │               │      │
 APPROVED         REJECTED   RETRY_LIMIT   RETRYING ──┘
    │                 │       │               │
    ▼                 ▼       ▼               │
┌─────────┐   ┌──────────┐ ┌───────────────────────────┐
│COMPLETED│   │ REWORK   │ │ AWAITING_HUMAN_           │
└─────────┘   └──────────┘ │ INTERVENTION              │
                           └──────┬──────────────┬─────┘
            (If REWORK, reset     │              │
             to PENDING)          ▼              ▼
                          RETRY (→ QUEUED)   CANCELLED
```

PENDING: Waiting for parent tasks (depends_on) to finish.

QUEUED: Dependencies met; placed in the dispatch queue.

EXECUTING: Agent Runtime has started.

VERIFYING: Execution finished; waiting for compilation/tests/lint (Verification Engine).

AWAITING_REVIEW: Verification passed, but Attention Engine flagged it for Human review.

APPROVED/REJECTED: Final Human judgment.

FAILED: Execution or Verification error. Orchestrator decides retry.

AWAITING_HUMAN_INTERVENTION: Retry limit exceeded, or unrecoverable/critical failure (also reachable from EXECUTING when the Agent Runtime reports it is stuck). The task is parked with its full trajectory and evidence attached; a human inspects and decides: retry, rework, or cancel.

# 4. Workflow Types
The Orchestrator must support different execution patterns from day one.

### 4.1 Linear (Pipeline)
Tasks execute one after another. Use case: "Lint, Build, Test, Deploy".

### 4.2 Fan-out / Fan-in (Parallel)
Multiple independent tasks run simultaneously, merging before the next critical step. Use case: "Generate unit tests AND integration tests AND docs simultaneously".

### 4.3 Conditional Branching
The path changes based on the output of a previous task. Use case: "If vulnerability scan fails, go to SecurityReview task; else, skip".

### 4.4 Directed Acyclic Graph (DAG)
Complex dependencies where tasks can have multiple parents and children. The Orchestrator must topologically sort the DAG to determine the execution order.

# 5. Interaction with other Subsystems
The Orchestrator is the central coordinator. Here is how it communicates with the other 9 subsystems defined in the Architecture.

```text
                     ┌─────────────────────────────────────┐
                     │       TASK / WORK ORCHESTRATOR      │
                     └──────────────┬──────────────────────┘
                                    │
          ┌─────────────────────────┼────────────────────────────┐
          │                         │                            │
          ▼                         ▼                            ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   AGENT RUNTIME │    │  VERIFICATION ENGINE │    │   ATTENTION ENGINE  │
│ (Executes Task) │    │  (Validates output)  │    │ (Assesses risk/review)│
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
          │                         │                            │
          └─────────────────────────┼────────────────────────────┘
                                    │
                                    ▼
                          ┌─────────────────────┐
                          │ EVIDENCE / MEMORY   │
                          │ (Stores trajectory) │
                          └─────────────────────┘
```

With Agent Runtime: Orchestrator prepares the Task input + Context and requests execution. It listens for status updates (Started, StepCompleted, ToolCalled, Finished).

With Verification Engine: When an Agent finishes, the Orchestrator automatically triggers the Verification Engine. It waits for the result (PASS / FAIL).

With Attention Engine: If Verification passes, the Orchestrator asks the Attention Engine: "Does this change need Human eyes?". If the Attention Engine returns REVIEW_REQUIRED, the Orchestrator parks the task in AWAITING_REVIEW.

With Memory / Evidence: The Orchestrator ensures that every significant state change (especially failures and human decisions) is emitted as an event to the Evidence system for traceability.

# 6. Internal Architecture of the Orchestrator
To keep it modular (as per the Monolith principle), the Orchestrator is split into four logical components:

```text
┌──────────────────────────────────────────────┐
│           TASK / WORK ORCHESTRATOR            │
├──────────────────────────────────────────────┤
│ 1. Planner / Decomposer                      │
│    - Converts natural language/Task into     │
│      a structured Workflow (DAG).            │
│                                              │
│ 2. Scheduler / Dispatcher                    │
│    - Evaluates DAG dependencies.             │
│    - Manages concurrency limits.             │
│    - Pushes Tasks to the Execution Queue.    │
│                                              │
│ 3. State Manager                             │
│    - Maintains the current state of all      │
│      Workflows and Tasks in a persistent     │
│      store (PostgreSQL initially).           │
│    - Handles "Checkpoints" for resume.       │
│                                              │
│ 4. Event Emitter / Listener                  │
│    - Emits domain events (TaskStarted,       │
│      TaskCompleted, ReviewRequired).         │
│    - Listens for internal async callbacks.   │
└──────────────────────────────────────────────┘
```

> **Dispatch model (Phase 1):** In-process and pull-based. The Scheduler is woken by domain events (e.g., `TaskQueued`, `AgentRuntimeIdle`), picks QUEUED tasks whose dependencies are satisfied, and hands them to the Agent Runtime via a direct method call inside the monolith. No external message broker in Phase 1; a durable queue (Redis/SQS) may replace the in-process hand-off in later phases without changing the event contracts.

# 7. Resilience & Failure Handling
Since the system is AI-native, failures are expected. The Orchestrator must be robust.

- **Timeouts:** Every Task has a `timeout_seconds`. If exceeded, the Task is marked FAILED and the Agent Runtime is forcefully terminated.
- **Retries:** Implements an exponential backoff. Only retries on transient errors (e.g., LLM API rate limit, network blip). Does not retry on logical failures (e.g., "Code compilation fails").
- **Human Escalation:** If a task fails `max_retries` times, the Orchestrator should automatically transition the Task to a special AWAITING_HUMAN_INTERVENTION state, allowing a Developer to inspect logs and manually override/retry.
- **Checkpointing:** For long-running workflows, the Orchestrator saves state after every Task completion. If the system crashes, it can restart from the last checkpoint instead of the beginning.
- **Crash recovery (startup reconciler, Day 28):** On a non-graceful crash (`SIGKILL`, not `SIGTERM`) a task can be stranded in `EXECUTING`/`VERIFYING`. The startup reconciler (`apps/api/src/reconcile.ts`) is the *only* sanctioned auto-repair: it runs **once at boot, before the dispatcher or runtime poll loop starts**, and moves each orphaned `EXECUTING`/`VERIFYING` task to `AWAITING_HUMAN_INTERVENTION` with reason `PROCESS_DIED`, publishing `task.orphan_recovered`. It never re-runs, re-queues, or decides — it escorts the task to a human. The before-loops ordering is load-bearing: if it ran after `DispatchLoop`/`RuntimePollLoop` began, an orphan could be double-run.
- **Compensation (Saga pattern, Phase 2+):** REWORK and ROLLBACK are not just state flips — a rejected change may have side effects that must be undone. Each workflow type carries a compensating action (roll back the artifact via the Artifact Tracker §8, reset verification cache), so a rejected branch leaves the system as if it never ran. This mirrors the framework's saga/compensation principle: *forward actions are paired with a defined undo*.
- **Circuit breaker (Phase 2+):** If an external dependency (LLM provider, CI, a verification tool) fails repeatedly, the Orchestrator opens a breaker for that dependency and fails fast with a clear `AWAITING_HUMAN_INTERVENTION` instead of queueing N doomed retries. This prevents one flaky integration from cascading failure across every in-flight task.

> **Workflow design principles (from the reference skills framework):** the four workflow types (§4) are designed for **idempotency** (retry a transition, not a side-effect), **observability** (every step emits an event), **separation** (orchestration vs execution — the Orchestrator owns *when*, the Agent owns *how*), **progressive disclosure** (start linear, add DAG/parallel only when needed), **fail-fast** (per above), and **state externalization** (state lives in Postgres, never in process memory only). These are the reasons §12's idempotency rule exists.

# 8. Event-Driven Communication
To remain decoupled, the Orchestrator primarily communicates via Domain Events.

> **Phase 1 event bus:** A lightweight in-process bus (e.g., Node EventEmitter) hidden behind an `IEventBus` interface. Modules only ever see the interface, so the bus can later be swapped for an external broker without touching module code. Every event is immutable and carries `event_id`, `event_type`, `event_version`, `occurred_at`, and `payload`; all events are also recorded to the Evidence store for replay and audit.

### Key Events Emitted

- `WorkflowCreated`
- `TaskQueued`
- `TaskExecutionStarted`
- `TaskToolCalled` (for observability)
- `TaskVerificationPassed` / `TaskVerificationFailed`
- `TaskReviewRequired`
- `TaskHumanApproved` / `TaskHumanRejected`
- `TaskCompleted`
- `TaskOrphanRecovered` — the startup reconciler recovering a stranded task (carries `PROCESS_DIED` reason and the stranded `from_state`)
- `WorkflowCompleted`

### Consumed Events

- `AgentRuntimeIdle` — Triggers the scheduler to push more tasks.
- `VerificationCompleted` — Triggers the transition to AWAITING_REVIEW or FAILED.
- `HumanDecisionSubmitted` — Triggers transition to APPROVED or REWORK.

# 9. API Surface (Internal/External)

### Internal API (for other modules)

```typescript
interface IOrchestratorService {
  createWorkflow(input: CreateWorkflowInput): Promise<Workflow>;
  submitTask(task: Task): Promise<void>;
  cancelWorkflow(workflowId: WorkflowID): Promise<void>;
  getWorkflowStatus(workflowId: WorkflowID): Promise<WorkflowStatus>;
  retryTask(taskId: TaskID): Promise<void>;
}
```

### External API (for the UI / CLI)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/workflows` | Create a new workflow (e.g., "Refactor module X") |
| GET | `/api/v1/workflows/{id}` | Get status and task tree |
| POST | `/api/v1/tasks/{id}/approve` | Human approves a pending review |
| POST | `/api/v1/tasks/{id}/reject` | Human rejects with reason |

# 10. Phase 1 Implementation Plan (Vertical Slice)
Following the Architecture roadmap, we build the Orchestrator incrementally.

### Phase 1: Sequential Linear Workflows

- Support only Linear workflows (Task A → Task B → Task C).
- Manual creation of Tasks (no automatic decomposition by AI yet).
- Basic State Management (PostgreSQL storage).
- Simple HTTP callbacks to trigger Agent Runtime.

### Phase 2: Parallel Execution & DAG

- Implement the topological Scheduler to support `depends_on`.
- Add Concurrency limits.
- Add basic retry logic.

### Phase 3: AI-Driven Decomposition

- Integrate the Context Engine + Agent Runtime to automatically break a large prompt into a Workflow of subtasks.
- The Planner becomes an internal AI Agent itself.

> **Decomposition strategy (from the reference skills framework):** the Phase-3 Planner is
> itself subject to the same *evidence before confidence* rule as any agent. It produces a
> plan, not a verdict, and the plan must pass checks before it becomes a Workflow:
>
> - **Three-level hierarchical planning** — goal → subtasks → atomic tasks; the atomic
>   tasks are what enter the DAG, not the raw goal.
> - **Plan-and-Solve / ReWOO** — separate "form a plan" from "execute the plan", so a bad
>   decomposition fails cheaply before any step runs. Dynamic replanning re-runs the
>   planner on REWORK with the failure evidence as input.
> - **Planning guardrails** (the framework's "10 Commandments") — a generated plan must be
>   *definite, bounded, and conservative*: decompose to testable units, never invent
>   steps the evidence does not support, and stop rather than over-engineer. A plan that
>   fails these checks escalates to a human instead of being auto-executed.

### Phase 4: Full Resilience & Auto-Escalation

- Implement Timeouts, Checkpointing, and the AWAITING_HUMAN_INTERVENTION state for critical failures.

# 11. Success Criteria
The Task / Work Orchestrator is considered successfully implemented when:

- A Developer can create a Workflow containing 5 sequential tasks, and the system executes them without manual intervention.
- If Task #3 fails, the system stops execution, marks Workflow as FAILED, and provides a clear error trace.
- If Task #3 passes but Verification fails, the system automatically triggers a REWORK task without external scripting.
- The State Manager can accurately answer: "What is the status of Task X and what evidence does it have?" in under 100ms.
- Adding a new type of Task (e.g., "SecurityScanTask") does not require changing the core Scheduler logic; only registering a new handler in the Agent Runtime.

# 12. Dependencies & Constraints

- **Data Store:** The State Manager requires a transactional database (PostgreSQL) to ensure consistency when updating multiple Task states simultaneously.
- **Idempotency:** The Orchestrator must handle duplicate events (e.g., double-callbacks from the Agent Runtime) gracefully. Concretely: (1) every event carries a unique `event_id`; consumers record processed IDs and ignore duplicates (at-least-once delivery, exactly-once effect); (2) every state transition validates that the current state allows it, so a repeated callback is a no-op rather than an illegal jump; (3) `executeTask` dispatch carries an idempotency key (`task_id + attempt_number`) so a retried dispatch never starts two agent runs for the same attempt.
- **Logging:** Every decision made by the Scheduler (why Task B waited for Task A) must be logged for debugging.

# 13. Next Steps (Concrete Actions)

- Define the Database Schema for Workflow, Task, and Dependency tables.
- Implement the core State Machine Transition function (`validTransitions`).
- Write the SimpleScheduler that resolves dependencies (only Sequential in v0.1).
- Implement the Event Bus listener to react to TaskCompleted events automatically.
- Write integration tests covering: Happy Path, Task Failure, and Retry Logic.

---

## Changelog

### v0.3 (Day 28)
- (Day 26): §7 — circuit breaker now also covers sandbox/eval degradation, matching the three fallback seams (semantic→keyword, object-store→db, sandbox→in-process).
### v0.2
- §7 — added the **startup reconciler** as a crash-recovery mechanism: orphaned
  `EXECUTING`/`VERIFYING` tasks are escorted to `AWAITING_HUMAN_INTERVENTION` with
  reason `PROCESS_DIED`, and its run-before-loops ordering constraint is recorded.
- §8 — added `TaskOrphanRecovered` (`task.orphan_recovered`) to the emitted events.
- Clarified `attempt_number` increments only on REWORK re-dispatch; the dispatch
  idempotency key is `task_id + attempt_number` (was ambiguous in v0.1).
- Confirmed the FailureClass taxonomy `TRANSIENT`/`PERMANENT`/`RESOURCE` (§7
  retries) as the shared retry vocabulary.
- No code divergences found: the state machine, retry policy, and event contracts
  match the implementation as built.