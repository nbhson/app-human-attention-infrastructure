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

import { existsSync, mkdirSync, readFileSync } from 'node:fs';

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
import type { LLMProvider, MockScript } from '@harness/agent-runtime';
import {
  ArtifactCaptureSubscriber,
  ArtifactTracker,
  ChangeStatusSubscriber,
  DiffEngine,
  SnapshotStore,
} from '@harness/artifact-tracker';
import {
  AttentionRouter,
  AttentionSubscriber,
  ATTENTION_POLICY_V1,
  AutoApproveExecutor,
  AutoApproveGate,
  AutoApproveKillSwitch,
  AutoApproveSampler,
  DbAutoApproveLoader,
  StaticWeightsAdapter,
} from '@harness/attention-engine';
import type { AutoApproveTaskTransition } from '@harness/attention-engine';
import {
  AuthService,
  MockOidcProvider,
  mockOidcConfigFromEnv,
  OpenIdClientProvider,
  SessionService,
} from '@harness/auth';
import {
  ApproxTokenizer,
  ContextEngine,
  extractFileReferences,
  FileCollector,
  KeywordDependencyRanker,
} from '@harness/context-engine';
import { Container, TOKENS, createRootLogger } from '@harness/di';
import type { Logger } from '@harness/di';
import { EventLogWriter, agentRuns, changes, createDb } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { brand, ChangeStatus, TaskStatus } from '@harness/domain';
import type { ChangeID, TaskID } from '@harness/domain';
import { OpenAICompatibleEmbedder, StubEmbedder } from '@harness/embeddings';
import type { Embedder } from '@harness/embeddings';
import { MetricsComputer } from '@harness/evaluation';
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
import { ReviewService } from '@harness/review';
import {
  CompileCheck,
  EvidenceStore,
  TestCheck,
  VerificationEngine,
} from '@harness/verification-engine';

import { ShellGitAdapter } from './services/git-adapter.js';
import type { GitAdapter } from './services/git-adapter.js';
import { MergeService } from './services/merge.js';
import { ReworkService } from './services/rework.js';

/** Default session lifetime (7 days), overridable via `SESSION_TTL_MS` (day-01 §2.2). */
const SECRET_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Engine tokens registered as stubs until their build day (Days 06+). */
const ENGINE_STUB_TOKENS = [
  TOKENS.Orchestrator,
  TOKENS.AgentRuntime,
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
 * Load a canned {@link MockScript} from a JSON path (day-25 §3.1). The E2E demo
 * needs a deterministic agent, so it points `MOCK_LLM_SCRIPT` at a fixture and
 * leaves `ANTHROPIC_API_KEY` unset. An unset path yields an empty script, which
 * fails loudly on first use (day-11 §6).
 */
function loadMockScript(envVar: string | undefined): MockScript {
  if (!envVar) {
    return [];
  }
  if (!existsSync(envVar)) {
    throw new Error(`MOCK_LLM_SCRIPT file not found: ${envVar}`);
  }
  return JSON.parse(readFileSync(envVar, 'utf8')) as MockScript;
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

/**
 * The COLLECT_CONTEXT step handler (day-20 §2.5).
 *
 * Owns the first step of the linear workflow: it resolves a ranked, budgeted
 * context snapshot for the task and puts its id in the step output so a later
 * step can consume it. The engine persists the snapshot into `contexts` for
 * provenance (day-20 §1). Target files are parsed out of the task description —
 * `TaskRecord` has no separate `target_files` column yet.
 */
function makeCollectContextHandler(container: Container): StepHandler {
  return async (stepCtx) => {
    const taskService = container.resolve<TaskService>(TOKENS.TaskService);
    const engine = container.resolve<ContextEngine>(TOKENS.ContextEngine);

    const task = await taskService.getTask(stepCtx.taskId);
    if (!task) {
      return {
        ok: false,
        error: 'task not found',
        failureClass: FailureClass.PERMANENT,
        retriable: false,
      };
    }

    const description = task.description ?? task.title;
    const snapshot = await engine.resolveContext({
      taskId: stepCtx.taskId,
      taskDescription: description,
      requirements: '',
      targetFiles: extractFileReferences(description),
      maxTokens: Number(process.env.CONTEXT_MAX_TOKENS ?? '8000'),
    });

    return { ok: true, output: { contextSnapshotId: snapshot.id } };
  };
}

/** Build the full container, wiring every token in dependency order. */
export function buildContainer(): Container {
  const c = new Container();

  // Day 13: the sandbox root must exist before any file tool runs (§6).
  const sandboxRoot = process.env.SANDBOX_ROOT ?? './sandbox';
  mkdirSync(sandboxRoot, { recursive: true });

  // Day 27 §2.1: the process-wide structured logger. Registered first so every
  // downstream engine and the bus's error handler can be handed the real thing.
  c.register(TOKENS.Logger, () => createRootLogger());

  c.register(TOKENS.EventBus, (container) => {
    const logger = container.resolve<Logger>(TOKENS.Logger);
    return new InProcessEventBus((eventType, error) =>
      logger.error('event-bus handler error', { event_type: eventType, error: String(error) }),
    );
  });

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
    const writer = new EventLogWriter(
      container.resolve(TOKENS.Db),
      container.resolve<Logger>(TOKENS.Logger),
    );
    writer.subscribeTo(container.resolve<IEventBus>(TOKENS.EventBus));
    return writer;
  });

  // Day-01: identity. The OIDC provider is env-driven — a mock for the local
  // demo/tests, a real `openid-client` adapter when an issuer is configured.
  c.register(TOKENS.OidcProvider, () => {
    if (process.env.OIDC_MOCK === 'true') {
      return new MockOidcProvider(mockOidcConfigFromEnv(process.env));
    }
    const issuerUrl = process.env.OIDC_ISSUER_URL;
    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;
    if (!issuerUrl || !clientId || !clientSecret) {
      throw new Error(
        'set OIDC_MOCK=true, or OIDC_ISSUER_URL + OIDC_CLIENT_ID + OIDC_CLIENT_SECRET for a real IdP',
      );
    }
    return new OpenIdClientProvider({ issuerUrl, clientId, clientSecret });
  });

  c.register(TOKENS.SessionService, (container) => {
    const ttlMs = Number(process.env.SESSION_TTL_MS ?? SECRET_SESSION_TTL_MS);
    return new SessionService(container.resolve<DrizzleDB>(TOKENS.Db), ttlMs);
  });

  c.register(TOKENS.AuthService, (container) => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret === 'dev-only-insecure-secret') {
      container
        .resolve<Logger>(TOKENS.Logger)
        .warn('JWT_SECRET is unset or the insecure dev default — do not use in production');
    }
    return new AuthService(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<SessionService>(TOKENS.SessionService),
      { jwtSecret: jwtSecret ?? 'dev-only-insecure-secret-change-me' },
    );
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
      container.resolve<Logger>(TOKENS.Logger),
    );
    subscriber.subscribe(container.resolve<IEventBus>(TOKENS.EventBus));
    return subscriber;
  });

  // Day 14: the sole writer of `changes.status` — PENDING→VERIFIED→REVIEWED and
  // any→ROLLED_BACK, driven only by events (day-14 §2.5). Idle until Days 15/22.
  c.register(TOKENS.ChangeStatusSubscriber, (container) => {
    const subscriber = new ChangeStatusSubscriber(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<Logger>(TOKENS.Logger),
    );
    subscriber.subscribe(container.resolve<IEventBus>(TOKENS.EventBus));
    return subscriber;
  });

  // Day 12: the attention weight seam. The provider returns the Phase-1
  // placeholder; the Day-12 fitter writes `calibration_weights` rows but does
  // NOT flip this registration (that is gated on Day 13/14). `AttentionSubscriber`
  // resolves the vector through this token so a single swap is all promotion
  // will require.
  c.register(TOKENS.WeightsProvider, () => new StaticWeightsAdapter());

  // Day 18: the Attention Engine's scoring subscriber. On `task.state_changed`
  // → AWAITING_REVIEW it computes the five Phase-1 factors, inserts an
  // `assessments` row, and publishes `attention.assessment_created`. The
  // `AttentionEngine` token itself stays a stub until its build day; this
  // subscriber is the engine's live integration point.
  c.register(TOKENS.AttentionSubscriber, (container) => {
    const subscriber = new AttentionSubscriber(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<Logger>(TOKENS.Logger),
      container.resolve<StaticWeightsAdapter>(TOKENS.WeightsProvider),
    );
    subscriber.subscribe(container.resolve<IEventBus>(TOKENS.EventBus));
    return subscriber;
  });

  // Day 19: the Attention Engine's routing service. On
  // `attention.assessment_created` it matches policy, applies §4.1 fatigue
  // controls, enqueues into `review_queue`, and publishes `attention.item_routed`.
  c.register(TOKENS.AttentionRouter, (container) => {
    const router = new AttentionRouter(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      ATTENTION_POLICY_V1,
      container.resolve<Logger>(TOKENS.Logger),
    );
    router.subscribe();
    return router;
  });

  // Day 14 (Phase 2): the auto-approve path. The gate is a pure evaluator over
  // the policy's static tuning; the kill-switch is a single seeded DB row; the
  // sampler duplicates a silent human control; the executor acts on
  // `attention.item_routed` AUTO_APPROVABLE items and stops at APPROVED
  // (`triggered_by: 'auto_approve'`) — MergeService closes APPROVED → COMPLETED,
  // exactly as for a human approval (§2.3, §2.4).
  c.register(TOKENS.AutoApproveGate, () => {
    return new AutoApproveGate({
      maxRisk: ATTENTION_POLICY_V1.autoApprove.maxRisk,
      inflationCeiling: ATTENTION_POLICY_V1.fatigue.inflationCeiling,
    });
  });

  c.register(TOKENS.AutoApproveKillSwitch, (container) => {
    return new AutoApproveKillSwitch(container.resolve<DrizzleDB>(TOKENS.Db));
  });

  c.register(TOKENS.AutoApproveSampler, (container) => {
    const sampler = new AutoApproveSampler(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      container.resolve<Logger>(TOKENS.Logger),
    );
    sampler.subscribe();
    return sampler;
  });

  c.register(TOKENS.AutoApproveExecutor, (container) => {
    const taskService = container.resolve<TaskService>(TOKENS.TaskService);
    const taskTransition: AutoApproveTaskTransition = {
      transitionTask: (taskId, toState, triggeredBy, opts) =>
        taskService.transitionTask(taskId, toState, triggeredBy, opts),
    };
    const executor = new AutoApproveExecutor({
      db: container.resolve<DrizzleDB>(TOKENS.Db),
      bus: container.resolve<IEventBus>(TOKENS.EventBus),
      gate: container.resolve<AutoApproveGate>(TOKENS.AutoApproveGate),
      killSwitch: container.resolve<AutoApproveKillSwitch>(TOKENS.AutoApproveKillSwitch),
      sampler: container.resolve<AutoApproveSampler>(TOKENS.AutoApproveSampler),
      taskTransition,
      policy: ATTENTION_POLICY_V1,
      loader: new DbAutoApproveLoader(container.resolve<DrizzleDB>(TOKENS.Db)),
      logger: container.resolve<Logger>(TOKENS.Logger),
    });
    executor.subscribe();
    return executor;
  });

  // Day 16: the text-embedding seam. Stub by default so the graph builds with no
  // external provider; a real OpenAI-compatible endpoint when `EMBEDDINGS_BASE_URL`
  // is set. The default ContextEngine keyword path never reads this token — the
  // mechanical shadow-then-default guarantee (day-16 §2.3).
  c.register(TOKENS.Embedder, () => {
    const baseUrl = process.env.EMBEDDINGS_BASE_URL;
    if (!baseUrl) {
      return new StubEmbedder();
    }
    return new OpenAICompatibleEmbedder({
      baseUrl,
      apiKey: process.env.EMBEDDINGS_API_KEY ?? '',
      model: process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small',
    });
  });

  // Day 20: the Context Engine. Resolves ranked, budgeted context for a task and
  // persists the snapshot into `contexts`. The FileCollector scans the sandbox
  // root the agent operates in, guarded by the same resolveSafe path check as the
  // Day-13 file tools (day-20 §2.2).
  c.register(TOKENS.ContextEngine, (container) => {
    return new ContextEngine(
      container.resolve<DrizzleDB>(TOKENS.Db),
      new FileCollector(sandboxRoot),
      new KeywordDependencyRanker(),
      new ApproxTokenizer(),
      container.resolve<Embedder>(TOKENS.Embedder),
    );
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
    const key = process.env.ANTHROPIC_API_KEY;
    const raw = key
      ? new AnthropicProvider(key)
      : new MockLLM(loadMockScript(process.env.MOCK_LLM_SCRIPT));
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

  // Day 22: the review backend. It drives the task state machine, the Day-19
  // alert-fatigue feedback loop, and the Day-17 diff engine through structural
  // seams (R6 — review may not import orchestrator, attention-engine, or
  // artifact-tracker), wired here at the composition root.
  c.register(TOKENS.ReviewService, (container) => {
    const taskService = container.resolve<TaskService>(TOKENS.TaskService);
    const attentionRouter = container.resolve<AttentionRouter>(TOKENS.AttentionRouter);
    const diffEngine = new DiffEngine(container.resolve<DrizzleDB>(TOKENS.Db));
    return new ReviewService(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      {
        transitionTask: (taskId, toState, triggeredBy, opts) =>
          taskService.transitionTask(taskId, toState, triggeredBy, opts),
      },
      {
        reportAssessmentFeedback: (assessmentId, wasUseful, comment) =>
          attentionRouter.reportAssessmentFeedback(assessmentId, wasUseful, comment),
      },
      { diffChange: (changeId) => diffEngine.diffChange(changeId) },
      container.resolve<Logger>(TOKENS.Logger),
    );
  });

  // Day 24: decision follow-through. `GitAdapter` owns the only git invocation
  // (in apps/api — never in packages/*); `MergeService` closes the approve path
  // and `ReworkService` the reject path. Both subscribe to `task.state_changed`.
  c.register(
    TOKENS.GitAdapter,
    () => new ShellGitAdapter(process.env.WORKING_REPO_ROOT ?? './working-repo'),
  );

  c.register(TOKENS.MergeService, (container) => {
    const service = new MergeService(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      container.resolve<GitAdapter>(TOKENS.GitAdapter),
      container.resolve<TaskService>(TOKENS.TaskService),
      container.resolve<Logger>(TOKENS.Logger),
    );
    service.subscribe();
    return service;
  });

  c.register(TOKENS.ReworkService, (container) => {
    const service = new ReworkService(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      container.resolve<TaskService>(TOKENS.TaskService),
      container.resolve<Logger>(TOKENS.Logger),
    );
    service.subscribe();
    return service;
  });

  // Day 08: the pull-based dispatch core. `Dispatcher` drives PENDING/REWORK →
  // QUEUED (or FAILED) via `TaskService`; `DispatchLoop` polls it on an interval.
  // The full multi-step Orchestrator (linear workflow, Day 09) is still a stub.
  c.register(TOKENS.Dispatcher, (container) => {
    return new Dispatcher(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<TaskService>(TOKENS.TaskService),
      container.resolve<IEventBus>(TOKENS.EventBus),
    );
  });

  c.register(TOKENS.DispatchLoop, (container) => {
    return new DispatchLoop(
      container.resolve<Dispatcher>(TOKENS.Dispatcher),
      container.resolve<Logger>(TOKENS.Logger),
    );
  });

  // Day 09: the linear workflow runner. COLLECT_CONTEXT is the real Context
  // Engine (Day 20); EXECUTE is a Phase-1 stub (driven by RuntimePollLoop's
  // AgentRunner handoff, not this handler); VERIFY is the real Verification
  // Engine (Day 15).
  c.register(TOKENS.WorkflowRunner, (container) => {
    const handlers = new Map<StepKind, StepHandler>([
      [StepKind.COLLECT_CONTEXT, makeCollectContextHandler(container)],
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
      container.resolve<Logger>(TOKENS.Logger),
    );
  });

  // Day 06: the offline metric evaluator. `MetricsComputer` is a stateless, pure
  // class (no Date.now/env/DB in `compute()`), so it registers with no deps. It is
  // *not* resolved on the hot path today — the standalone `pnpm eval:metrics` CLI
  // constructs it directly. The registration exists so the Day-07 report
  // generator (`EVAL_REPORT_SCHEDULE` cron) can resolve it in-process and push the
  // computed window onto the scraped register on a schedule.
  c.register(TOKENS.MetricsComputer, () => new MetricsComputer());

  // Engines are wired on their own build days; until then each token resolves
  // to a stub so the architecture test can build the graph end-to-end.
  for (const token of ENGINE_STUB_TOKENS) {
    c.register(token, () => notYetImplemented(token));
  }

  return c;
}

/**
 * Resolve every eagerly-initialised token so its side effect (bus subscription)
 * is live before any task runs. The server (`index.ts`) and the Day-25 E2E
 * driver both call this — component registrations are lazy, so without an eager
 * resolve the subscribers never bind to the bus.
 */
export function bootContainer(container: Container): void {
  container.resolve(TOKENS.EventLogWriter);
  container.resolve(TOKENS.ArtifactCaptureSubscriber);
  container.resolve(TOKENS.ChangeStatusSubscriber);
  container.resolve(TOKENS.AttentionSubscriber);
  container.resolve(TOKENS.AttentionRouter);
  container.resolve(TOKENS.AutoApproveSampler);
  container.resolve(TOKENS.AutoApproveExecutor);
  container.resolve(TOKENS.ContextEngine);
  container.resolve(TOKENS.ReviewService);
  container.resolve(TOKENS.MergeService);
  container.resolve(TOKENS.ReworkService);
}
