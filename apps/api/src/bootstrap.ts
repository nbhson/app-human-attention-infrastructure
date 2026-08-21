/**
 * The single place the object graph is wired.
 *
 * Dependencies are registered in strict topological order (day-05 §2.3): the
 * event bus first, then the database, then the writer that forwards bus events
 * into `event_log`, and finally the engine slots. Engines receive `IEventBus`
 * (never `InProcessEventBus`) so they stay swappable.
 *
 * Rule (day-05 §6): `new InProcessEventBus()` may appear *only* here. Anywhere
 * else that needs the bus must `resolve(TOKENS.EventBus)`.
 */

import { mkdirSync } from 'node:fs';

import { and, desc, eq } from 'drizzle-orm';

import {
  AgentRunner,
  AnthropicProvider,
  LoggingLLMProvider,
  makeListDirectoryTool,
  makeReadFileTool,
  makeWriteFileTool,
  MockLLM,
  RuntimePollLoop,
  ToolAllowlist,
  ToolRegistry,
  TrajectoryRecorder,
} from '@harness/agent-runtime';
import type { LLMProvider } from '@harness/agent-runtime';
import {
  ArtifactCaptureSubscriber,
  ArtifactTracker,
  ChangeStatusSubscriber,
  SnapshotStore,
} from '@harness/artifact-tracker';
import { Container, TOKENS } from '@harness/di';
import { EventLogWriter, agentRuns, changes, createDb } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { brand, ChangeStatus, TaskStatus } from '@harness/domain';
import type { ChangeID, TaskID } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import {
  Dispatcher,
  DispatchLoop,
  FailureClass,
  LINEAR_WORKFLOW_V1,
  StepKind,
  TaskService,
  TaskStateMachine,
  WorkflowRunner,
} from '@harness/orchestrator';
import type { StepHandler } from '@harness/orchestrator';
import {
  CompileCheck,
  EvidenceStore,
  TestCheck,
  VerificationEngine,
} from '@harness/verification-engine';

/** Engine tokens registered as stubs until their build day (Days 06+). */
const ENGINE_STUB_TOKENS = [
  TOKENS.Orchestrator,
  TOKENS.AgentRuntime,
  TOKENS.ContextEngine,
  TOKENS.AttentionEngine,
] as const;

/**
 * Return a stand-in for an engine that has not been built yet. The stand-in is
 * constructible (so the graph resolves), but any interaction throws a clear
 * "not yet implemented" instead of silently doing nothing.
 */
function notYetImplemented(token: string): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        // A thenable proxy would be mistaken for a Promise by `await`.
        if (property === 'then') {
          return undefined;
        }
        throw new Error(`[di] "${token}" is not yet implemented`);
      },
    },
  );
}

/**
 * Resolve the task's latest `PENDING` change through `agent_runs` (day-15 §2.5).
 * A change is produced by an agent run, so the join is `changes → agent_runs →
 * task`. Returns `null` when the task has not produced a change yet.
 */
async function findLatestPendingChangeId(db: DrizzleDB, taskId: TaskID): Promise<ChangeID | null> {
  const rows = await db
    .select({ id: changes.id })
    .from(changes)
    .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
    .where(and(eq(agentRuns.task_id, taskId), eq(changes.status, ChangeStatus.Pending)))
    .orderBy(desc(changes.created_at))
    .limit(1);
  const id = rows[0]?.id;
  return id ? brand(id, 'ChangeID') : null;
}

/**
 * The VERIFY step handler (day-15 §2.2, §2.5).
 *
 * Owns the `VERIFYING` lifecycle — the line before it is EXECUTING, so it enters
 * `VERIFYING` first, then drives the engine and lands the task in `AWAITING_REVIEW`
 * (PASSED) or `REWORK` (FAILED). It always returns `{ ok: true }` on a verdict, so
 * the {@link WorkflowRunner} never escalates a *failed verification* to
 * `AWAITING_HUMAN_INTERVENTION` — a failing change is a REWORK, not an infra error.
 */
function makeVerifyHandler(container: Container): StepHandler {
  return async (stepCtx) => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);
    const taskService = container.resolve<TaskService>(TOKENS.TaskService);
    const engine = container.resolve<VerificationEngine>(TOKENS.VerificationEngine);

    const task = await taskService.getTask(stepCtx.taskId);
    if (!task) {
      return {
        ok: false,
        error: 'task not found',
        failureClass: FailureClass.PERMANENT,
        retriable: false,
      };
    }

    // Enter the VERIFYING state (EXECUTING → VERIFYING). REWORK re-dispatch keeps
    // the task in REWORK/EXECUTING, so guard on the current state.
    if (task.state === TaskStatus.Executing) {
      await taskService.transitionTask(stepCtx.taskId, TaskStatus.Verifying, 'verification_engine');
    }

    const changeId = await findLatestPendingChangeId(db, stepCtx.taskId);
    if (!changeId) {
      // No change to verify: request infra gap, not a REWORK-able failure.
      await taskService.transitionTask(stepCtx.taskId, TaskStatus.Failed, 'verification_engine');
      return { ok: true, output: { error: 'no pending change to verify' } };
    }

    const report = await engine.verify(changeId);

    if (report.overall === 'PASSED') {
      await taskService.transitionTask(
        stepCtx.taskId,
        TaskStatus.AwaitingReview,
        'verification_engine',
      );
      return { ok: true, output: { reportId: report.id } };
    }

    await taskService.transitionTask(stepCtx.taskId, TaskStatus.Rework, 'verification_engine', {
      rationale:
        report.failedChecks.length > 0
          ? `verification failed: ${report.failedChecks.join(', ')}`
          : 'verification failed',
    });
    return { ok: true, output: { reportId: report.id, failedChecks: report.failedChecks } };
  };
}

/** Build the full container, wiring every token in dependency order. */
export function buildContainer(): Container {
  const c = new Container();

  // Day 13: the sandbox root must exist before any file tool runs (§6).
  const sandboxRoot = process.env.SANDBOX_ROOT ?? './sandbox';
  mkdirSync(sandboxRoot, { recursive: true });

  c.register(TOKENS.EventBus, () => new InProcessEventBus());

  c.register(TOKENS.Db, () => {
    const url = process.env.DATABASE_URL;
    if (!url || url.length === 0) {
      throw new Error(
        'DATABASE_URL is not set. Copy .env.example to .env (repo root) or export DATABASE_URL.',
      );
    }
    return createDb(url);
  });

  c.register(TOKENS.EventLogWriter, (container) => {
    const writer = new EventLogWriter(container.resolve(TOKENS.Db));
    writer.subscribeTo(container.resolve<IEventBus>(TOKENS.EventBus));
    return writer;
  });

  // Day 14: the full Artifact Tracker. `SnapshotStore` is content-addressed
  // storage; `ArtifactTracker.capture` is the transactional
  // get-or-create-artifact → change → snapshot writer. The Day-13 capture
  // subscriber now forwards `artifact.created` into the tracker instead of doing
  // its own inline insert.
  c.register(TOKENS.SnapshotStore, () => new SnapshotStore());

  c.register(TOKENS.ArtifactTracker, (container) => {
    return new ArtifactTracker(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<SnapshotStore>(TOKENS.SnapshotStore),
    );
  });

  c.register(TOKENS.ArtifactCaptureSubscriber, (container) => {
    const subscriber = new ArtifactCaptureSubscriber(
      container.resolve<ArtifactTracker>(TOKENS.ArtifactTracker),
    );
    subscriber.subscribe(container.resolve<IEventBus>(TOKENS.EventBus));
    return subscriber;
  });

  // Day 14: the sole writer of `changes.status` — PENDING→VERIFIED→REVIEWED and
  // any→ROLLED_BACK, driven only by events (day-14 §2.5). Idle until Days 15/22.
  c.register(TOKENS.ChangeStatusSubscriber, (container) => {
    const subscriber = new ChangeStatusSubscriber(container.resolve<DrizzleDB>(TOKENS.Db));
    subscriber.subscribe(container.resolve<IEventBus>(TOKENS.EventBus));
    return subscriber;
  });

  // Day 15: the Verification Engine — full/parallel strategy, two-level timeouts,
  // and the first real check (CompileCheck). Resolved by the VERIFY step handler.
  // Day 16: TestCheck joins the registry with retry-once flaky handling.
  // Day 17: EvidenceStore holds untruncated check output; every check result
  // links back to its evidence through `evidence_id`.
  c.register(TOKENS.EvidenceStore, () => new EvidenceStore());

  c.register(TOKENS.VerificationEngine, (container) => {
    return new VerificationEngine(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      { checks: [new CompileCheck(), new TestCheck()] },
      container.resolve<EvidenceStore>(TOKENS.EvidenceStore),
    );
  });

  // Day 11: the LLM provider abstraction. A real Anthropic adapter when a key is
  // set; otherwise an empty MockLLM so the graph builds but any live call fails
  // loudly (day-11 §6). Wrapped in LoggingLLMProvider for provenance.
  c.register(TOKENS.LLMProvider, (container) => {
    const raw = process.env.ANTHROPIC_API_KEY
      ? new AnthropicProvider(process.env.ANTHROPIC_API_KEY)
      : new MockLLM([]);
    return new LoggingLLMProvider(raw, container.resolve<DrizzleDB>(TOKENS.Db));
  });

  // Day 06: the canonical state machine + its public service.
  c.register(TOKENS.TaskStateMachine, () => new TaskStateMachine());

  c.register(TOKENS.TaskService, (container) => {
    return new TaskService(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      container.resolve<TaskStateMachine>(TOKENS.TaskStateMachine),
    );
  });

  // Day 08: the pull-based dispatch core. `Dispatcher` drives PENDING/REWORK →
  // QUEUED (or FAILED) via `TaskService`; `DispatchLoop` polls it on an interval.
  // The full multi-step Orchestrator (linear workflow, Day 09) is still a stub.
  c.register(TOKENS.Dispatcher, (container) => {
    return new Dispatcher(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<TaskService>(TOKENS.TaskService),
    );
  });

  c.register(TOKENS.DispatchLoop, (container) => {
    return new DispatchLoop(container.resolve<Dispatcher>(TOKENS.Dispatcher));
  });

  // Day 09: the linear workflow runner. COLLECT_CONTEXT/EXECUTE are Phase-1
  // stubs (context lands Day 20; EXECUTE is driven by RuntimePollLoop's AgentRunner
  // handoff, not this handler); VERIFY is the real Verification Engine (Day 15).
  c.register(TOKENS.WorkflowRunner, (container) => {
    const handlers = new Map<StepKind, StepHandler>([
      [StepKind.COLLECT_CONTEXT, async () => ({ ok: true, output: { stub: true } })],
      [StepKind.EXECUTE, async () => ({ ok: true, output: { stub: true } })],
      [StepKind.VERIFY, makeVerifyHandler(container)],
    ]);
    return new WorkflowRunner(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<TaskService>(TOKENS.TaskService),
      handlers,
    );
  });

  // Day 13: the tool catalogue — three real sandbox tools behind an allowlist.
  // `ToolRegistry` carries the bus so `write_file` can publish `artifact.created`.
  c.register(TOKENS.ToolRegistry, (container) => {
    const allowed = new Set(
      (process.env.AGENT_ALLOWED_TOOLS ?? 'read_file,write_file,list_directory').split(','),
    );
    const registry = new ToolRegistry(
      new ToolAllowlist(allowed),
      container.resolve<IEventBus>(TOKENS.EventBus),
    );
    registry.register(makeReadFileTool(sandboxRoot));
    registry.register(makeWriteFileTool(sandboxRoot));
    registry.register(makeListDirectoryTool(sandboxRoot));
    return registry;
  });

  // Day 13: the per-step audit trail, injected into the AgentRunner's ReAct loop.
  c.register(TOKENS.TrajectoryRecorder, (container) => {
    return new TrajectoryRecorder(container.resolve<DrizzleDB>(TOKENS.Db));
  });

  // Day 12: the AgentRunner owns one task's execution. `TaskService` is injected
  // through the runner's structural seam and the completion handoff is a closure
  // that starts the linear workflow, so agent-runtime never imports orchestrator.
  c.register(TOKENS.AgentRunner, (container) => {
    const workflowRunner = container.resolve<WorkflowRunner>(TOKENS.WorkflowRunner);
    const maxSteps = Number(process.env.AGENT_MAX_STEPS ?? '10');
    const tokenLimit = Number(process.env.AGENT_TOKEN_BUDGET ?? '50000');
    return new AgentRunner(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      container.resolve<LLMProvider>(TOKENS.LLMProvider),
      container.resolve<ToolRegistry>(TOKENS.ToolRegistry),
      container.resolve<TaskService>(TOKENS.TaskService),
      { runLinearWorkflow: (taskId) => workflowRunner.run(taskId, LINEAR_WORKFLOW_V1) },
      maxSteps,
      tokenLimit,
      container.resolve<TrajectoryRecorder>(TOKENS.TrajectoryRecorder),
    );
  });

  c.register(TOKENS.RuntimePollLoop, (container) => {
    return new RuntimePollLoop(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<AgentRunner>(TOKENS.AgentRunner),
    );
  });

  // Engines are wired on their own build days; until then each token resolves
  // to a stub so the architecture test can build the graph end-to-end.
  for (const token of ENGINE_STUB_TOKENS) {
    c.register(token, () => notYetImplemented(token));
  }

  return c;
}
