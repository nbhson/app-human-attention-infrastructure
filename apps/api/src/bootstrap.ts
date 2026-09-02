/**
 * The single place the object graph is wired.
 *
 * Dependencies are registered in strict topological order (day-05 §2.3): the
 * event bus first, then the database, then the writer that forwards bus events
 * into `event_log`, and finally the engine slots. Engines receive `IEventBus`
 * (never `InProcessEventBus`) so they stay swappable.
 *
 * Rule (day-05 §6): a concrete event bus may be constructed *only* here (via
 * `buildEventBus`). Anywhere else that needs the bus must `resolve(TOKENS.EventBus)`.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';

import {
  AnthropicProvider,
  LoggingLLMProvider,
  MockLLM,
  OpenAICompatibleProvider,
  ReviewAgent,
} from '@harness/agent-runtime';
import type { LLMProvider, MockScript } from '@harness/agent-runtime';
import {
  ArtifactCaptureSubscriber,
  ArtifactTracker,
  ChangeStatusSubscriber,
  DEFAULT_OBJECT_STORE_THRESHOLD_BYTES,
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
  DbWeightsProvider,
} from '@harness/attention-engine';
import type { AutoApproveTaskTransition } from '@harness/attention-engine';
import type { Logger } from '@harness/di';
import {
  AuthService,
  MockOidcProvider,
  mockOidcConfigFromEnv,
  OpenIdClientProvider,
  SessionService,
} from '@harness/auth';
import {
  CacheInvalidationListener,
  ContextEngine,
  FileCollector,
  KeywordDependencyRanker,
  MemoryContextResolver,
  PostgresContextCache,
  SemanticRanker,
  SemanticRetriever,
  TiktokenTokenizer,
} from '@harness/context-engine';
import type { ContextCache } from '@harness/context-engine';
import { Container, TOKENS, createRootLogger } from '@harness/di';
import {
  DrizzleJudgeRunStore,
  DrizzleWritebackLogStore,
  EventLogWriter,
  createDb,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { AiProviderType } from '@harness/domain';
import type { MemoryProvider } from '@harness/domain';
import {
  EmbeddingIndexer,
  OpenAICompatibleEmbedder,
  ReembedListener,
  StubEmbedder,
} from '@harness/embeddings';
import type { Embedder } from '@harness/embeddings';
import { MetricsComputer } from '@harness/evaluation';
import { buildEventBus, resolveEventTransport } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { MemoryDistiller, MemoryIngestor, MemoryRetriever, MemoryStore } from '@harness/memory';
import { MemoryLifecycle } from '@harness/memory';
import { TaskService, TaskStateMachine } from '@harness/orchestrator';
import type { ContentStore } from '@harness/object-store';
import {
  AwsS3ClientPort,
  InMemoryContentStore,
  ObjectStoreContentStore,
} from '@harness/object-store';
import { ReviewService } from '@harness/review';
import { Judge } from '@harness/judge';
import { DockerSandbox } from '@harness/sandbox';
import type { Sandbox, SandboxLimits } from '@harness/sandbox';
import {
  CloneCompileCheck,
  CloneTestCheck,
  CloneVerifier,
  CompileCheck,
  EvidenceStore,
  SandboxedCheck,
  SandboxRunner,
  TestCheck,
  VerificationEngine,
} from '@harness/verification-engine';

import { GitHubProvider, StaticGitToolMap } from '@harness/git-provider';
import type { GitProvider } from '@harness/git-provider';
import { loadMcpConfig, McpServerRegistryImpl } from '@harness/mcp';
import type { McpServerRegistry } from '@harness/mcp';
import { JiraProvider, StaticTicketToolMap } from '@harness/ticket-provider';
import type { TicketProvider } from '@harness/ticket-provider';
import { MCPWriteBack } from '@harness/writeback';
import type { WriteBackService } from '@harness/writeback';

import { ReviewIngestService } from './services/review-ingest.js';
import { ReviewWorkerSubscriber } from './services/review-worker.js';
import { ReviewVerificationService } from './services/review-verification.js';
import { JudgeShadow } from './services/judge-shadow.js';
import { envInt } from './env-utils.js';

/** Default session lifetime (7 days), overridable via `SESSION_TTL_MS` (day-01 §2.2). */
const SECRET_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Retired engine tokens — code-gen was retired in the review-reorient pivot.
 * Kept as stubs so the DI graph stays stable (nothing depends on these tokens
 * at runtime; the real work lives in TaskService / ReviewAgent /
 * AttentionSubscriber + AttentionRouter). Tests verify they still throw
 * "not yet implemented" to prevent accidental unstubbing.
 */
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
 * Resolve the AI vendor + model from env (review-reorient Phase 3), used to
 * stamp provenance onto a review report. Every non-Anthropic vendor resolves
 * through `AI_BASE_URL`'s OpenAI-compatible endpoint; `custom` is the catch-all.
 */
function resolveAiIdentity(): { providerType: AiProviderType; model: string } {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      providerType: AiProviderType.Anthropic,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    };
  }
  if (process.env.AI_BASE_URL) {
    const configured = (process.env.AI_PROVIDER ?? '').toLowerCase();
    const providerType =
      configured === 'openai' || configured === 'gemini' || configured === 'opencode'
        ? (configured as AiProviderType)
        : AiProviderType.Custom;
    return { providerType, model: process.env.AI_MODEL ?? 'gpt-4.1' };
  }
  return { providerType: AiProviderType.Custom, model: 'mock' };
}

/** Build the raw (unwrapped) AI provider: Anthropic > OpenAI-compatible > Mock. */
function buildRawLLMProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
  }
  const baseUrl = process.env.AI_BASE_URL;
  if (baseUrl) {
    return new OpenAICompatibleProvider({
      apiKey: process.env.AI_API_KEY ?? '',
      baseUrl,
      model: process.env.AI_MODEL ?? 'gpt-4.1',
      // A reasoning-capable model (deepseek/openai-reasoner style) spends output
      // budget on chain-of-thought *and* the review JSON. With `AI_MAX_TOKENS` at
      // 32k and this model generating ~65 tok/s, a large review can run ~8 min, so
      // the timeout must cover the *token budget*, not just the common case. 600s
      // ≈ the full 32k budget at the measured rate — raise `AI_TIMEOUT_MS` on a
      // slower endpoint, and `AI_MAX_TOKENS` alongside it for very large PRs.
      timeoutMs: envInt('AI_TIMEOUT_MS', 600_000),
    });
  }
  return new MockLLM(loadMockScript(process.env.MOCK_LLM_SCRIPT));
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
    // Day-34: the optional durable transport swap. `EVENT_TRANSPORT=redis|sqs`
    // requires an operator-supplied StreamTransport adapter — for this repo's
    // zero-config deploy, `inproc` (the default) keeps the in-memory bus. Engines
    // resolve `TOKENS.EventBus` (IEventBus), never a concrete transport.
    return buildEventBus(resolveEventTransport(process.env.EVENT_TRANSPORT), {
      onHandlerError: (eventType, error) =>
        logger.error('event-bus handler error', { event_type: eventType, error: String(error) }),
    });
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

  // Day 21 (object store): the content-addressing seam. Large snapshot content
  // is offloaded through `TOKENS.ContentStore` when an S3/MinIO endpoint is
  // configured (`OBJECT_STORE_ENDPOINT`); without one, the store falls back to
  // an ephemeral in-memory backend *and* the offload threshold is `Infinity`, so
  // no bytes ever leave `snapshots` — the Phase-1 inline path stays the default.
  c.register(TOKENS.ContentStore, () => {
    const endpoint = process.env.OBJECT_STORE_ENDPOINT;
    if (!endpoint) {
      return new InMemoryContentStore('object');
    }
    const bucket = process.env.OBJECT_STORE_BUCKET ?? 'harness-artifacts';
    const region = process.env.OBJECT_STORE_REGION;
    const accessKeyId = process.env.OBJECT_STORE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.OBJECT_STORE_SECRET_ACCESS_KEY;
    return new ObjectStoreContentStore(
      new AwsS3ClientPort({
        bucket,
        endpoint,
        ...(region !== undefined ? { region } : {}),
        ...(accessKeyId !== undefined
          ? { accessKeyId, secretAccessKey: secretAccessKey ?? '' }
          : {}),
      }),
      process.env.OBJECT_STORE_PREFIX ?? 'artifacts/',
    );
  });

  const objectStoreConfigured = Boolean(process.env.OBJECT_STORE_ENDPOINT);
  const objectStoreThreshold = objectStoreConfigured
    ? Number(
        process.env.OBJECT_STORE_THRESHOLD_BYTES ?? String(DEFAULT_OBJECT_STORE_THRESHOLD_BYTES),
      )
    : Infinity;

  // Day 14: the full Artifact Tracker. `SnapshotStore` is content-addressed
  // storage; `ArtifactTracker.capture` is the transactional
  // get-or-create-artifact → change → snapshot writer. The Day-13 capture
  // subscriber now forwards `artifact.created` into the tracker instead of doing
  // its own inline insert. Day-21 wires the `ContentStore` seam into the
  // snapshot writer as its Storage Manager for large content.
  c.register(
    TOKENS.SnapshotStore,
    (container) =>
      new SnapshotStore(container.resolve<ContentStore>(TOKENS.ContentStore), objectStoreThreshold),
  );

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

  // Day 12: the attention weight seam. CF-2 (day-41): when `FITTED_WEIGHTS_ENABLED=1`,
  // swap the static placeholder for a DB-backed provider that reads the latest
  // promotion-worthy fit from `calibration_weights`. Otherwise the engine stays
  // on the Phase-1 placeholder for byte-for-byte reproducibility.
  if (process.env.FITTED_WEIGHTS_ENABLED === '1') {
    c.register(
      TOKENS.WeightsProvider,
      (container) =>
        new DbWeightsProvider(
          () => container.resolve<DrizzleDB>(TOKENS.Db),
          container.resolve<Logger>(TOKENS.Logger),
        ),
    );
  } else {
    c.register(TOKENS.WeightsProvider, () => new StaticWeightsAdapter());
  }

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
      container.resolve<ContentStore>(TOKENS.ContentStore),
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

  // Day 17: the semantic index. `EmbeddingIndexer` is the batch/resumable/
  // idempotent population core — used out-of-band by `pnpm embed:populate` and
  // re-used by the listener. `ReembedListener` keeps the vector column fresh:
  // on `artifact.created`/`artifact.changed` it re-embeds the affected FILE
  // source keyed on `content_hash`, publishing nothing (day-17 §6).
  c.register(TOKENS.EmbeddingIndexer, (container) => {
    return new EmbeddingIndexer(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<Embedder>(TOKENS.Embedder),
      {},
      container.resolve<Logger>(TOKENS.Logger),
    );
  });

  c.register(TOKENS.ReembedListener, (container) => {
    const listener = new ReembedListener(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<EmbeddingIndexer>(TOKENS.EmbeddingIndexer),
      container.resolve<Logger>(TOKENS.Logger),
    );
    listener.subscribe(container.resolve<IEventBus>(TOKENS.EventBus));
    return listener;
  });

  // Day 18: the semantic retrieval path, registered OUT of the default resolve
  // path. `SemanticRetriever` is the cosine-similarity primitive over the Day-17
  // index; `SemanticRanker` wraps it with the freshness guard + target-file rule.
  // Neither is read by `makeCollectContextHandler` (which calls `resolveContext`),
  // so the live rank_method stays keyword unless a caller opts into
  // `resolveWithShadow`.
  c.register(TOKENS.SemanticRetriever, (container) => {
    return new SemanticRetriever(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<Embedder>(TOKENS.Embedder),
    );
  });

  c.register(TOKENS.SemanticRanker, (container) => {
    return new SemanticRanker(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<Embedder>(TOKENS.Embedder),
      container.resolve<SemanticRetriever>(TOKENS.SemanticRetriever),
    );
  });

  // Day 20: the context source cache — a read-optimization leaf between the
  // collector and the filesystem. Postgres-backed (no Redis: the modular-monolith
  // rule keeps a single store). Hit/miss counters mirror onto the Day-04
  // Prometheus registry; the invalidation listener keeps the stat fast-path
  // honest by dropping a row the moment its artifact changes (day-20 §2.2).
  c.register(TOKENS.ContextCache, (container) => {
    return new PostgresContextCache(container.resolve<DrizzleDB>(TOKENS.Db));
  });

  c.register(TOKENS.CacheInvalidationListener, (container) => {
    const listener = new CacheInvalidationListener(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<ContextCache>(TOKENS.ContextCache),
      container.resolve<Logger>(TOKENS.Logger),
    );
    listener.subscribe(container.resolve<IEventBus>(TOKENS.EventBus));
    return listener;
  });

  // Day 20: the Context Engine. Resolves ranked, budgeted context for a task and
  // persists the snapshot into `contexts`. The FileCollector scans the sandbox
  // root the agent operates in, guarded by the same resolveSafe path check as the
  // Day-13 file tools (day-20 §2.2). The Day-18 semantic ranker is wired as the
  // 6th arg but only reachable via `resolveWithShadow` (opt-in per request).
  c.register(TOKENS.ContextEngine, (container) => {
    return new ContextEngine(
      container.resolve<DrizzleDB>(TOKENS.Db),
      new FileCollector(sandboxRoot, container.resolve<ContextCache>(TOKENS.ContextCache)),
      new KeywordDependencyRanker(),
      new TiktokenTokenizer(),
      container.resolve<Embedder>(TOKENS.Embedder),
      container.resolve<SemanticRanker>(TOKENS.SemanticRanker),
    );
  });

  // Day 15: the Verification Engine — full/parallel strategy, two-level timeouts,
  // and the first real check (CompileCheck). Resolved by the VERIFY step handler.
  // Day 16: TestCheck joins the registry with retry-once flaky handling.
  // Day 17: EvidenceStore holds untruncated check output; every check result
  // links back to its evidence through `evidence_id`.
  c.register(TOKENS.EvidenceStore, () => new EvidenceStore());

  // Day 22: the container Sandbox seam. `VERIFY_SANDBOX_ENABLED=1` swaps the
  // COMPILE check to a `SandboxedCheck` (sandbox primary, in-process fallback);
  // otherwise the in-process path stays the default. The image must be pre-built
  // (`docker build -t harness-verify:node20 packages/sandbox`) or `docker run`
  // exits 125 and the fallback fires with a logged warning.
  c.register(TOKENS.Sandbox, () => new DockerSandbox());

  c.register(TOKENS.VerificationEngine, (container) => {
    const compileCheck = new CompileCheck();
    const checks = [
      process.env.VERIFY_SANDBOX_ENABLED === '1'
        ? new SandboxedCheck({
            inner: compileCheck,
            sandbox: container.resolve<Sandbox>(TOKENS.Sandbox),
            image: process.env.VERIFY_SANDBOX_IMAGE ?? 'harness-verify:node20',
            buildCommand: () => ['bash', '-lc', 'cd /workdir && tsc --noEmit -p .'],
            limits: {
              cpu: process.env.VERIFY_SANDBOX_CPU ?? '1.0',
              memory: process.env.VERIFY_SANDBOX_MEMORY ?? '512m',
              timeoutSeconds: Math.ceil(compileCheck.timeoutMs / 1000),
            },
            logger: container.resolve<Logger>(TOKENS.Logger),
          })
        : compileCheck,
      new TestCheck(),
    ];
    return new VerificationEngine(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      { checks },
      container.resolve<EvidenceStore>(TOKENS.EvidenceStore),
    );
  });

  // Day 11: the LLM provider abstraction. Real Anthropic when a key is set; an
  // OpenAI-compatible endpoint when `AI_BASE_URL` is set (the "any provider"
  // escape hatch for openai/gemini/opencode/custom); otherwise an empty MockLLM
  // so the graph builds but any live call fails loudly (day-11 §6). Wrapped in
  // LoggingLLMProvider for provenance.
  c.register(TOKENS.LLMProvider, (container) => {
    return new LoggingLLMProvider(buildRawLLMProvider(), container.resolve<DrizzleDB>(TOKENS.Db));
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

  // Review-reorient: the external-PR review slice. Providers resolve
  // to `null` (and `ingest` fails with a clear status) when their env creds are
  // absent, so the app still boots when review providers are not configured.
  c.register(TOKENS.GitProvider, () => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return null;
    }
    return new GitHubProvider(token, process.env.GITHUB_BASE_URL ?? 'https://api.github.com');
  });

  c.register(TOKENS.TicketProvider, () => {
    const baseUrl = process.env.JIRA_BASE_URL;
    const token = process.env.JIRA_TOKEN;
    if (!baseUrl || !token) {
      return null;
    }
    return new JiraProvider(token, baseUrl);
  });

  // Review-reorient Phase 3 (day-02): the MCP connection layer. The registry is
  // parsed from `mcp.config.json` (or `MCP_CONFIG_PATH`) once at startup; a
  // missing file means "no MCP servers configured" and the settings routes
  // return an empty list — the app still boots, exactly like the null providers
  // above. Connectivity stays in the file; the DB mirror holds only display
  // state (day-02 §6).
  c.register(TOKENS.McpServerRegistry, (): McpServerRegistry => {
    const path = process.env.MCP_CONFIG_PATH ?? './mcp.config.json';
    return new McpServerRegistryImpl(loadMcpConfig(path, process.env));
  });

  // Review-reorient Phase 3 (day-06): the write-back seam. One entry point for
  // commentary/status write-back, backed by the same MCP transport Week 1
  // connected — no second REST channel. The `enabled` guard defaults to the
  // `WRITEBACK_*` env toggle (off), so nothing external is written unless armed.
  c.register(TOKENS.WriteBackService, (container): WriteBackService => {
    return new MCPWriteBack(
      container.resolve<McpServerRegistry>(TOKENS.McpServerRegistry),
      new StaticGitToolMap(),
      new StaticTicketToolMap(),
      new DrizzleWritebackLogStore(container.resolve<DrizzleDB>(TOKENS.Db)),
    );
  });

  c.register(TOKENS.ReviewAgent, (container) => {
    const llm = container.resolve<LLMProvider>(TOKENS.LLMProvider);
    // Headroom above the ordinary 8k so a reasoning model's chain-of-thought
    // plus an exhaustive review JSON don't truncate (see buildRawLLMProvider).
    return new ReviewAgent(llm, envInt('AI_MAX_TOKENS', 32_000));
  });

  c.register(TOKENS.ReviewIngestService, (container) => {
    const identity = resolveAiIdentity();
    return new ReviewIngestService({
      db: container.resolve<DrizzleDB>(TOKENS.Db),
      bus: container.resolve<IEventBus>(TOKENS.EventBus),
      taskService: container.resolve<TaskService>(TOKENS.TaskService),
      gitProvider: container.resolve<GitProvider | null>(TOKENS.GitProvider),
      ticketProvider: container.resolve<TicketProvider | null>(TOKENS.TicketProvider),
      reviewAgent: container.resolve<ReviewAgent>(TOKENS.ReviewAgent),
      aiProvider: identity.providerType,
      model: identity.model,
      logger: container.resolve<Logger>(TOKENS.Logger),
      memoryProvider: container.resolve<MemoryProvider>(TOKENS.MemoryProvider),
      maxBatchSize: envInt('REVIEW_MAX_BATCH_SIZE', 5),
      maxBatchTokens: envInt('REVIEW_MAX_BATCH_TOKENS', 8000),
      twoPassEnabled: process.env.REVIEW_TWO_PASS === 'true',
      maxConcurrency: envInt('REVIEW_MAX_CONCURRENCY', 10),
    });
  });

  // Phase 4: background review worker — subscribes to `review.requested` and
  // processes the AI review pipeline asynchronously so the HTTP route returns 202.
  c.register(TOKENS.ReviewWorkerSubscriber, (container) => {
    const worker = new ReviewWorkerSubscriber(
      container.resolve<ReviewIngestService>(TOKENS.ReviewIngestService),
      container.resolve<IEventBus>(TOKENS.EventBus),
      container.resolve<Logger>(TOKENS.Logger),
    );
    worker.subscribe();
    return worker;
  });

  // Review-reorient Phase 3 (wedge #1): the "run the real code" verifier. A
  // `CloneVerifier` runs the PR clone's own `build` then `test` in the Docker
  // sandbox (never the harness process); `ReviewVerificationService` subscribes to
  // `review.report_created` and drives it fire-and-forget after the report is
  // stored. On by default (opt out via `VERIFY_REVIEW_ENABLED=0`), sandbox-only, never a gate.
  c.register(TOKENS.ReviewVerifier, (container) => {
    const image = process.env.VERIFY_SANDBOX_IMAGE ?? 'harness-verify:node20';
    const limits: SandboxLimits = {
      cpu: process.env.VERIFY_SANDBOX_CPU ?? '1.0',
      memory: process.env.VERIFY_SANDBOX_MEMORY ?? '512m',
      timeoutSeconds: Number(process.env.VERIFY_CLONE_TIMEOUT_S ?? '600'),
    };
    const runner = new SandboxRunner({
      sandbox: container.resolve<Sandbox>(TOKENS.Sandbox),
      image,
      limits,
    });
    return new CloneVerifier({
      compile: new CloneCompileCheck(runner),
      test: new CloneTestCheck(runner),
    });
  });

  c.register(TOKENS.ReviewVerificationService, (container) => {
    const service = new ReviewVerificationService({
      db: container.resolve<DrizzleDB>(TOKENS.Db),
      bus: container.resolve<IEventBus>(TOKENS.EventBus),
      gitProvider: container.resolve<GitProvider | null>(TOKENS.GitProvider),
      verifier: container.resolve<CloneVerifier>(TOKENS.ReviewVerifier),
      enabled:
        process.env.VERIFY_REVIEW_ENABLED !== '0' && process.env.VERIFY_REVIEW_ENABLED !== 'false',
      logger: container.resolve<Logger>(TOKENS.Logger),
    });
    service.subscribe();
    return service;
  });

  // Review-reorient Phase 3 (day-21): the review-quality judge, shadow-only.
  // `Judge` calls the LLMProvider seam and records every run through the Drizzle
  // port (`judge_runs`); nothing reads the scores yet — day-22 wires the
  // consumer, day-23 feeds weight fitting. The judge is a pure measurement: its
  // output never mutates a review or decision (boundary §2.4).
  c.register(TOKENS.Judge, (container) => {
    return new Judge(
      container.resolve<LLMProvider>(TOKENS.LLMProvider),
      new DrizzleJudgeRunStore(container.resolve<DrizzleDB>(TOKENS.Db)),
      resolveAiIdentity().model,
    );
  });

  // The shadow trigger that runs the judge after `review.report_created` — log-
  // only, fire-and-forget on its own failure (day-21 §3.4).
  c.register(TOKENS.JudgeShadow, (container) => {
    const shadow = new JudgeShadow(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      container.resolve<Judge>(TOKENS.Judge),
      container.resolve<Logger>(TOKENS.Logger),
    );
    shadow.subscribe();
    return shadow;
  });

  // Review-reorient Phase 3 (day-16): curated review memory with evidence
  // provenance. `MemoryStore` is the only writer of `memory_entries` (each
  // entry carries ≥1 `memory_entry_evidence` link) and publishes
  // `memory.entry_created` so Context/Attention can fan in via the bus. It
  // consumes nothing from the bus, so no eager boot is required here.
  c.register(TOKENS.MemoryStore, (container) => {
    return new MemoryStore(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      container.resolve<Logger>(TOKENS.Logger),
    );
  });

  // Review-reorient Phase 3 (wedge #2): the memory *write* half. `MemoryIngestor`
  // subscribes to `review.report_created` / `review.report_decision_submitted` and
  // distills each into a REVIEW/FINDING/DECISION entry grounded in an evidence
  // row. Previously the read side was wired and the write half was left idle; this
  // registration + eager boot closes that gap.
  c.register(TOKENS.MemoryIngestor, (container) => {
    const ingestor = new MemoryIngestor(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      container.resolve<MemoryStore>(TOKENS.MemoryStore),
      new MemoryDistiller(),
      container.resolve<Logger>(TOKENS.Logger),
    );
    ingestor.subscribe();
    return ingestor;
  });

  // Review-reorient Phase 3 (day-18): the memory *read* seam. `MemoryRetriever`
  // ranks head-of-chain entries behind the domain `MemoryProvider` contract (so
  // `@harness/context-engine` reads it without importing `@harness/memory`), and
  // `MemoryContextResolver` injects the top-K as a `memory` section on a context
  // snapshot.
  c.register(TOKENS.MemoryProvider, (container) => {
    return new MemoryRetriever(
      container.resolve<MemoryStore>(TOKENS.MemoryStore),
      () => new Date(),
      container.resolve<Logger>(TOKENS.Logger),
    );
  });

  c.register(TOKENS.MemoryContextResolver, (container) => {
    return new MemoryContextResolver(container.resolve<MemoryProvider>(TOKENS.MemoryProvider));
  });

  // Review-reorient Phase 3 (day-19): the idempotent memory lifecycle tick
  // (consolidate → decay → archive). Registered but NOT eagerly started — a
  // server entrypoint drives `MemoryLifecycle.tick` (directly or via the
  // `MemoryLifecycleScheduler` in `@harness/memory`) on a cadence. Consumes
  // nothing from the bus, so no eager boot is required here.
  c.register(TOKENS.MemoryLifecycle, (container) => {
    return new MemoryLifecycle(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<IEventBus>(TOKENS.EventBus),
      container.resolve<Logger>(TOKENS.Logger),
    );
  });

  // Day 22: the review backend. It drives the task state machine, the Day-19
  // alert-fatigue feedback loop, and the Day-17 diff engine through structural
  // seams (R6 — review may not import orchestrator, attention-engine, or
  // artifact-tracker), wired here at the composition root.
  c.register(TOKENS.ReviewService, (container) => {
    const taskService = container.resolve<TaskService>(TOKENS.TaskService);
    const attentionRouter = container.resolve<AttentionRouter>(TOKENS.AttentionRouter);
    const diffEngine = new DiffEngine(
      container.resolve<DrizzleDB>(TOKENS.Db),
      container.resolve<ContentStore>(TOKENS.ContentStore),
    );
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
  container.resolve(TOKENS.ReembedListener);
  container.resolve(TOKENS.ReviewService);
  container.resolve(TOKENS.JudgeShadow);
  container.resolve(TOKENS.ReviewVerificationService);
  container.resolve(TOKENS.MemoryIngestor);
  container.resolve(TOKENS.ReviewWorkerSubscriber);
}
