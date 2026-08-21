/**
 * Day-26 E2E failure paths (day-26 §2.1) — the eight scenarios that prove the
 * harness degrades *safely* instead of succeeding loudly.
 *
 * Each scenario boots the real object graph (scripted MockLLM, real agent /
 * dispatcher / verification / review / merge plumbing) and drives one task down
 * a failure path, asserting the persisted outcome:
 *
 *   S1  verification FAILED → REWORK → QUEUED (attempt 2), report + evidence
 *   S2  verification FAILED at max_attempts → FAILED + task.failed
 *   S3  flaky test → AWAITING_REVIEW routed REVIEW_REQUIRED (r3-flaky)
 *   S4  agent exceeds max steps → ESCALATED + AWAITING_HUMAN_INTERVENTION
 *   S5  token budget exceeded → classified RESOURCE + TOKEN_BUDGET_EXCEEDED
 *   S6  human rejects with rationale → REWORK, rationale in the next prompt
 *   S7  merge conflict on approve → AWAITING_HUMAN_INTERVENTION, no commit
 *   S8  graceful drain on shutdown → no orphaned EXECUTING row
 *
 * S1/S2/S4/S5 are driven deterministically (dispatch + run inline); S3/S6/S7
 * reuse the Day-25 happy-path loop pattern; S8 drains the loops in-process.
 *
 * Run via `pnpm e2e` (happy path first, then this). Needs `DATABASE_URL`.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { config } from 'dotenv';
import { and, count, desc, eq, sql } from 'drizzle-orm';

import {
  LoggingLLMProvider,
  MockLLM,
  mockTextResponse,
  mockToolCallResponse,
  TokenBudgetExceededError,
} from '@harness/agent-runtime';
import type {
  AgentRunner,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  MockScript,
  RuntimePollLoop,
} from '@harness/agent-runtime';
import { buildProvenanceChain } from '@harness/artifact-tracker';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import {
  agentRuns,
  artifacts,
  changes,
  createDb,
  eventLog,
  evidence,
  projects,
  tasks,
  trajectorySteps,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { ArtifactStatus, EventType, newProjectID, TaskStatus } from '@harness/domain';
import type { ProjectID } from '@harness/domain';
import { classifyError } from '@harness/orchestrator';
import type { Dispatcher, DispatchLoop, TaskService } from '@harness/orchestrator';

import { buildApp } from '../src/app.js';
import { bootContainer, buildContainer } from '../src/bootstrap.js';

const execFileP = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SANDBOX_BASE = join(REPO_ROOT, 'sandbox/e2e-failure');
const WORKING_BASE = join(REPO_ROOT, 'working-repo/failure');

// --- Scripted-agent fixtures (inline, deterministic) -----------------------

const GREETING_OK = `/** A tiny greeting helper. */\nexport function greeting(name: string): string {\n  return \`Hello, \${name.toLowerCase()}!\`;\n}\n`;

const GREETING_BROKEN = `/** A tiny greeting helper (broken by the agent). */\nexport function greeting(name: string): string {\n  return \`Hello, \${name.toLowercase()}!\`;\n}\n`;

const GREETING_TEST = `import { describe, expect, it } from 'vitest';\n\nimport { greeting } from './greeting';\n\ndescribe('greeting', () => {\n  it('greets with a lowercased name', () => {\n    expect(greeting('ADA')).toBe('Hello, ada!');\n  });\n});\n`;

// Flaky by construction: the counter file lives in the worktree, so the first
// vitest run reads 0 (and fails `expect(n).toBe(1)`), the retry reads 1 (passes).
const FLAKY_TEST = `import { existsSync, readFileSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { expect, it } from 'vitest';\n\nconst counterPath = join(process.cwd(), '.flaky-counter.txt');\nconst n = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;\nwriteFileSync(counterPath, String(n + 1));\n\nit('passes on the retry', () => {\n  expect(n).toBe(1);\n});\n`;

const TS_CONFIG = `{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "moduleResolution": "Bundler",\n    "strict": true,\n    "skipLibCheck": true,\n    "noEmit": true,\n    "types": []\n  },\n  "include": ["src"]\n}\n`;

// Node types must be visible or the flaky test's `node:fs` import fails the
// compile check (§S3). `@types/node` resolves by walking up to the repo root.
const TS_CONFIG_NODE = `{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "moduleResolution": "Bundler",\n    "strict": true,\n    "skipLibCheck": true,\n    "noEmit": true,\n    "types": ["node"]\n  },\n  "include": ["src"]\n}\n`;

// Pins Vitest to the sandbox's own suite. `TestCheck` runs `vitest run --root
// <worktree>`, but `--root` alone does not stop Vitest from walking *up* to find
// a config; the sandbox lives under this monorepo, whose root `vitest.config.ts`
// only includes `packages/*`/`apps/*` tests, so without a local config the
// sandbox's `src/flaky.test.ts` never executes and the check reports "no tests".
const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  test: {\n    include: ['src/**/*.test.ts'],\n    environment: 'node',\n  },\n});\n`;

/** Fix the greeting (used by S3, S6, S7, S8). */
const FIX_SCRIPT: MockScript = [
  mockToolCallResponse('read_file', 'c1', { path: 'src/greeting.ts' }),
  mockToolCallResponse('write_file', 'c2', { path: 'src/greeting.ts', content: GREETING_OK }),
  mockTextResponse('Fixed the greeting helper.'),
];

/** Break the greeting so the compile check fails (S1, S2). */
const BREAK_SCRIPT: MockScript = [
  mockToolCallResponse('read_file', 'c1', { path: 'src/greeting.ts' }),
  mockToolCallResponse('write_file', 'c2', { path: 'src/greeting.ts', content: GREETING_BROKEN }),
  mockTextResponse('Broke the greeting helper.'),
];

/** Three tool-use turns with no end_turn → max_steps (S4). */
const MAX_STEPS_SCRIPT: MockScript = [
  mockToolCallResponse('read_file', 'c1', { path: 'src/greeting.ts' }),
  mockToolCallResponse('read_file', 'c2', { path: 'src/greeting.ts' }),
  mockToolCallResponse('read_file', 'c3', { path: 'src/greeting.ts' }),
];

/** One tool-use turn whose usage (18 tokens) blows a 5-token budget (S5). */
const TOKEN_BUDGET_SCRIPT: MockScript = [
  mockToolCallResponse('read_file', 'c1', { path: 'src/greeting.ts' }),
];

/** A provider that stalls each call, so scenario 8 can catch an in-flight run. */
class SlowLLM implements LLMProvider {
  readonly calls: LLMRequest[] = [];
  private readonly queue: LLMResponse[];

  constructor(
    script: MockScript,
    private readonly delayMs: number,
  ) {
    this.queue = [...script];
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push(req);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, this.delayMs));
    const next = this.queue.shift();
    if (!next) {
      throw new Error('SlowLLM: script exhausted');
    }
    return next;
  }
}

// --- Shared helpers --------------------------------------------------------

interface CreateTaskResponse {
  readonly id: string;
}
interface QueueItemJson {
  readonly id: string;
  readonly taskId: string;
  readonly ruleId: string;
}
interface RunRow {
  readonly status: string;
  readonly steps_used: number;
  readonly escalation_reason: string | null;
}

const TITLE = 'Fix the greeting bug';
const DESCRIPTION = 'Fix the greeting bug in src/greeting.ts so the test passes.';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`[e2e] ${msg}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`[e2e] timed out waiting for ${label}`);
}

/**
 * Poll the review queue until the task's item lands. Routing is fire-and-forget
 * off `TaskStateChanged → AWAITING_REVIEW` (`assess` → `route` → insert), so the
 * row can arrive a few event-loop/DB round-trips *after* the state is visible.
 */
async function waitForQueueItem(
  app: ReturnType<typeof buildApp>,
  taskId: string,
  label: string,
): Promise<QueueItemJson> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const queue = (
      await app.inject({ method: 'GET', url: '/api/review/queue' })
    ).json() as QueueItemJson[];
    const item = queue.find((entry) => entry.taskId === taskId);
    if (item) {
      return item;
    }
    await sleep(250);
  }
  throw new Error(`[e2e] timed out waiting for ${label}`);
}

/** Write a fixture tree (relative path → content) into a fresh sandbox dir. */
function prepareSandbox(dir: string, files: Record<string, string>): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content, 'utf8');
  }
}

/** A clean git repo the MergeService can commit into (S3, S6, S7, S8). */
async function prepareWorkingRepo(workDir: string): Promise<void> {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, 'README.md'), '# harness working repo\n');
  await git(workDir, ['init']);
  await git(workDir, ['config', 'user.email', 'harness-e2e@example.com']);
  await git(workDir, ['config', 'user.name', 'Harness E2E']);
  await git(workDir, ['config', 'commit.gpgSign', 'false']);
  await git(workDir, ['add', '-A']);
  await git(workDir, ['commit', '-m', 'chore: init working repo']);
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileP('git', args, { cwd });
}

async function truncateAll(db: DrizzleDB): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE t text;
    BEGIN
      FOR t IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
      LOOP
        EXECUTE format('TRUNCATE TABLE public.%I CASCADE', t);
      END LOOP;
    END $$;
  `);
}

/** Set scenario env vars; agent limits are reset per scenario (no leakage). */
function withEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
}

function resetAgentEnv(): void {
  delete process.env.AGENT_MAX_STEPS;
  delete process.env.AGENT_TOKEN_BUDGET;
}

/** Override the LLM provider with a scripted one, wrapped for provenance. */
function installProvider(container: Container, raw: LLMProvider): void {
  container.register(
    TOKENS.LLMProvider,
    (c) => new LoggingLLMProvider(raw, c.resolve<DrizzleDB>(TOKENS.Db)),
  );
}

/** Insert a project row and return its branded id (manual scenarios). */
async function insertProject(db: DrizzleDB, name: string, repoPath: string): Promise<ProjectID> {
  const id = newProjectID();
  await db.insert(projects).values({ id, name, repo_path: repoPath });
  return id;
}

/** Create a task through the real HTTP surface and return its id. */
async function postTask(
  app: ReturnType<typeof buildApp>,
  repoPath: string,
  title: string,
  description: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title, description, repoPath },
  });
  assert(res.statusCode === 201, `POST /api/tasks → ${res.statusCode}: ${res.body}`);
  return (res.json() as CreateTaskResponse).id;
}

async function taskHasState(db: DrizzleDB, taskId: string, state: TaskStatus): Promise<boolean> {
  const rows = await db
    .select({ state: tasks.state })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return rows[0]?.state === state;
}

async function taskAttempt(db: DrizzleDB, taskId: string): Promise<number | null> {
  const rows = await db
    .select({ attempt_number: tasks.attempt_number })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return rows[0]?.attempt_number ?? null;
}

async function runCount(db: DrizzleDB, taskId: string): Promise<number> {
  const rows = await db.select({ n: count() }).from(agentRuns).where(eq(agentRuns.task_id, taskId));
  return rows[0]?.n ?? 0;
}

async function latestRun(db: DrizzleDB, taskId: string): Promise<RunRow | null> {
  const rows = await db
    .select({
      status: agentRuns.status,
      steps_used: agentRuns.steps_used,
      escalation_reason: agentRuns.escalation_reason,
    })
    .from(agentRuns)
    .where(eq(agentRuns.task_id, taskId))
    .orderBy(desc(agentRuns.attempt_number))
    .limit(1);
  return rows[0] ?? null;
}

async function reportVerdict(db: DrizzleDB, taskId: string): Promise<string | null> {
  const rows = await db
    .select({ overall: verificationReports.overall })
    .from(verificationReports)
    .where(eq(verificationReports.task_id, taskId))
    .orderBy(desc(verificationReports.created_at))
    .limit(1);
  return rows[0]?.overall ?? null;
}

async function reportFlaky(db: DrizzleDB, taskId: string): Promise<boolean | null> {
  const rows = await db
    .select({ flaky: verificationReports.flaky })
    .from(verificationReports)
    .where(eq(verificationReports.task_id, taskId))
    .orderBy(desc(verificationReports.created_at))
    .limit(1);
  return rows[0]?.flaky ?? null;
}

async function evidenceCount(db: DrizzleDB): Promise<number> {
  const rows = await db.select({ n: count() }).from(evidence);
  return rows[0]?.n ?? 0;
}

async function trajectoryCount(db: DrizzleDB, taskId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(trajectorySteps)
    .innerJoin(agentRuns, eq(agentRuns.id, trajectorySteps.agent_run_id))
    .where(eq(agentRuns.task_id, taskId));
  return rows[0]?.n ?? 0;
}

async function taskFailedReason(db: DrizzleDB, taskId: string): Promise<string | null> {
  const rows = await db
    .select({ payload: eventLog.payload })
    .from(eventLog)
    .where(and(eq(eventLog.event_type, EventType.TaskFailed), eq(eventLog.correlation_id, taskId)))
    .orderBy(desc(eventLog.occurred_at))
    .limit(1);
  const payload = rows[0]?.payload as { reason?: string } | undefined;
  return payload?.reason ?? null;
}

async function anyCommitSha(db: DrizzleDB, taskId: string): Promise<boolean> {
  const rows = await db
    .select({ commit_sha: changes.commit_sha })
    .from(changes)
    .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
    .where(eq(agentRuns.task_id, taskId));
  return rows.some((row) => row.commit_sha !== null);
}

async function anyArtifactMerged(db: DrizzleDB, taskId: string): Promise<boolean> {
  const rows = await db
    .select({ status: artifacts.status })
    .from(artifacts)
    .innerJoin(changes, eq(changes.artifact_id, artifacts.id))
    .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
    .where(eq(agentRuns.task_id, taskId));
  return rows.some((row) => row.status === ArtifactStatus.Merged);
}

// --- Scenarios -------------------------------------------------------------

/** S1 — a verify that fails compiles routes to REWORK, then re-queue (attempt 1). */
async function scenario1(): Promise<void> {
  const dir = join(SANDBOX_BASE, 's1-verify-failed');
  const workDir = join(WORKING_BASE, 's1');
  resetAgentEnv();
  withEnv({ SANDBOX_ROOT: dir, WORKING_REPO_ROOT: workDir });
  prepareSandbox(dir, {
    'tsconfig.json': TS_CONFIG,
    'src/greeting.ts': GREETING_OK,
    'src/greeting.test.ts': GREETING_TEST,
  });
  await prepareWorkingRepo(workDir);

  const container = buildContainer();
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const evidenceBefore = await evidenceCount(db);
  installProvider(container, new MockLLM(BREAK_SCRIPT));
  bootContainer(container);

  const taskService = container.resolve<TaskService>(TOKENS.TaskService);
  const dispatcher = container.resolve<Dispatcher>(TOKENS.Dispatcher);
  const runner = container.resolve<AgentRunner>(TOKENS.AgentRunner);
  const projectId = await insertProject(db, 'e2e-failure-s1', dir);
  const task = await taskService.createTask({ projectId, title: TITLE, description: DESCRIPTION });

  // Attempt 0: dispatch → QUEUED; the agent's broken fix fails verify → REWORK.
  const d0 = await dispatcher.dispatchPending();
  assert(d0.dispatched === 1, `s1: dispatch #1 dispatched ${d0.dispatched}`);
  assert(await taskHasState(db, task.id, TaskStatus.Queued), 's1: attempt 0 not QUEUED');
  await runner.runTask(task.id);
  await waitFor(() => taskHasState(db, task.id, TaskStatus.Rework), 30_000, 's1: task → REWORK');

  assert((await taskAttempt(db, task.id)) === 0, 's1: attempt bumped before re-dispatch');
  assert((await reportVerdict(db, task.id)) === 'FAILED', 's1: report overall != FAILED');
  assert((await evidenceCount(db)) > evidenceBefore, 's1: no evidence recorded');

  // Re-dispatch: REWORK → QUEUED, and the attempt is incremented exactly once.
  const d1 = await dispatcher.dispatchPending();
  assert(d1.dispatched === 1, `s1: re-dispatch dispatched ${d1.dispatched}`);
  assert(await taskHasState(db, task.id, TaskStatus.Queued), 's1: task not re-QUEUED');
  assert((await taskAttempt(db, task.id)) === 1, 's1: attempt not incremented to 1');

  console.log('[e2e][s1] verification FAILED → REWORK → QUEUED (attempt 2) ✓');
}

/** S2 — exhausting max_attempts routes to FAILED with a catch-all task.failed. */
async function scenario2(): Promise<void> {
  const dir = join(SANDBOX_BASE, 's2-max-attempts');
  const workDir = join(WORKING_BASE, 's2');
  resetAgentEnv();
  withEnv({ SANDBOX_ROOT: dir, WORKING_REPO_ROOT: workDir });
  prepareSandbox(dir, {
    'tsconfig.json': TS_CONFIG,
    'src/greeting.ts': GREETING_OK,
    'src/greeting.test.ts': GREETING_TEST,
  });
  await prepareWorkingRepo(workDir);

  const container = buildContainer();
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  installProvider(container, new MockLLM([...BREAK_SCRIPT, ...BREAK_SCRIPT, ...BREAK_SCRIPT]));
  bootContainer(container);

  const taskService = container.resolve<TaskService>(TOKENS.TaskService);
  const dispatcher = container.resolve<Dispatcher>(TOKENS.Dispatcher);
  const runner = container.resolve<AgentRunner>(TOKENS.AgentRunner);
  const projectId = await insertProject(db, 'e2e-failure-s2', dir);
  const task = await taskService.createTask({
    projectId,
    title: TITLE,
    description: DESCRIPTION,
    maxAttempts: 2,
  });

  // Attempts 0, 1, 2 each verify FAILED → REWORK.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const d = await dispatcher.dispatchPending();
    assert(d.dispatched === 1, `s2: dispatch (attempt ${attempt}) dispatched ${d.dispatched}`);
    await runner.runTask(task.id);
    await waitFor(
      () => taskHasState(db, task.id, TaskStatus.Rework),
      30_000,
      `s2: task → REWORK (attempt ${attempt})`,
    );
  }

  // Attempt 2 is exhausted: the next dispatch FAILs it instead of queueing a 4th.
  const exhausted = await dispatcher.dispatchPending();
  assert(exhausted.failed === 1, `s2: exhausted dispatch failed ${exhausted.failed}`);
  assert(exhausted.dispatched === 0, 's2: exhausted dispatch queued a 4th attempt');
  assert(await taskHasState(db, task.id, TaskStatus.Failed), 's2: task not FAILED');
  assert((await taskAttempt(db, task.id)) === 2, 's2: FAILED attempt count != 2');
  assert((await runCount(db, task.id)) === 3, 's2: expected 3 agent runs (attempts 0,1,2)');
  assert(
    (await taskFailedReason(db, task.id)) === 'MAX_ATTEMPTS_EXHAUSTED',
    's2: task.failed reason != MAX_ATTEMPTS_EXHAUSTED',
  );

  // A FAILED task still renders a full provenance chain (day-26 §5).
  const chain = await buildProvenanceChain(db, task.id);
  assert(chain.task !== null && chain.task.state === 'FAILED', 's2: provenance task != FAILED');
  assert(chain.agentRun !== null, 's2: provenance missing agent run');
  assert(chain.artifacts.length >= 1, 's2: provenance missing artifacts');
  assert(chain.verification.reports.length >= 1, 's2: provenance missing verification reports');
  assert(chain.events.length >= 1, 's2: provenance missing events');

  console.log('[e2e][s2] max attempts → FAILED + task.failed(MAX_ATTEMPTS_EXHAUSTED) ✓');
}

/** S3 — a flaky test still yields PASSED with flaky:true, routed r3-flaky. */
async function scenario3(): Promise<void> {
  const dir = join(SANDBOX_BASE, 's3-flaky');
  const workDir = join(WORKING_BASE, 's3');
  resetAgentEnv();
  withEnv({ SANDBOX_ROOT: dir, WORKING_REPO_ROOT: workDir });
  prepareSandbox(dir, {
    'tsconfig.json': TS_CONFIG_NODE,
    'vitest.config.ts': VITEST_CONFIG,
    'src/greeting.ts': GREETING_OK,
    'src/flaky.test.ts': FLAKY_TEST,
  });
  await prepareWorkingRepo(workDir);

  const container = buildContainer();
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  installProvider(container, new MockLLM(FIX_SCRIPT));
  bootContainer(container);
  const app = buildApp(container);
  const dispatchLoop = container.resolve<DispatchLoop>(TOKENS.DispatchLoop);
  const runtimeLoop = container.resolve<RuntimePollLoop>(TOKENS.RuntimePollLoop);

  try {
    dispatchLoop.start(100);
    runtimeLoop.start(100);

    const taskId = await postTask(app, dir, TITLE, DESCRIPTION);

    await waitFor(
      () => taskHasState(db, taskId, TaskStatus.AwaitingReview),
      120_000,
      's3: task → AWAITING_REVIEW',
    );

    assert((await reportVerdict(db, taskId)) === 'PASSED', 's3: overall != PASSED');
    assert((await reportFlaky(db, taskId)) === true, 's3: report not flaky');

    const item = await waitForQueueItem(app, taskId, 's3: task routed into the review queue');
    assert(item.ruleId === 'r3-flaky', `s3: rule = ${item.ruleId}`);
  } finally {
    dispatchLoop.stop();
    runtimeLoop.stop();
    await Promise.all([dispatchLoop.waitForIdle(), runtimeLoop.waitForIdle()]);
  }

  console.log('[e2e][s3] flaky test → AWAITING_REVIEW, r3-flaky, flaky: true ✓');
}

/** S4 — max_steps escalation records the reason and a complete trajectory. */
async function scenario4(): Promise<void> {
  const dir = join(SANDBOX_BASE, 's4-max-steps');
  resetAgentEnv();
  withEnv({ SANDBOX_ROOT: dir, AGENT_MAX_STEPS: '3' });

  const container = buildContainer();
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  installProvider(container, new MockLLM(MAX_STEPS_SCRIPT));
  bootContainer(container);

  const taskService = container.resolve<TaskService>(TOKENS.TaskService);
  const dispatcher = container.resolve<Dispatcher>(TOKENS.Dispatcher);
  const runner = container.resolve<AgentRunner>(TOKENS.AgentRunner);
  const projectId = await insertProject(db, 'e2e-failure-s4', dir);
  const task = await taskService.createTask({ projectId, title: TITLE, description: DESCRIPTION });

  await dispatcher.dispatchPending();
  await runner.runTask(task.id);

  assert(
    await taskHasState(db, task.id, TaskStatus.AwaitingHumanIntervention),
    's4: task not AWAITING_HUMAN_INTERVENTION',
  );
  const run = await latestRun(db, task.id);
  assert(
    run?.escalation_reason === 'MAX_STEPS_EXCEEDED',
    `s4: escalation_reason = ${run?.escalation_reason}`,
  );
  assert(run?.steps_used === 3, `s4: steps_used = ${run?.steps_used}`);
  assert((await trajectoryCount(db, task.id)) === 3, 's4: trajectory incomplete');

  console.log('[e2e][s4] max steps → AWAITING_HUMAN_INTERVENTION (MAX_STEPS_EXCEEDED) ✓');
}

/** S5 — a token overrun escalates and classifies RESOURCE (cooldown-then-retry). */
async function scenario5(): Promise<void> {
  const dir = join(SANDBOX_BASE, 's5-token-budget');
  resetAgentEnv();
  withEnv({ SANDBOX_ROOT: dir, AGENT_TOKEN_BUDGET: '5' });

  const container = buildContainer();
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  installProvider(container, new MockLLM(TOKEN_BUDGET_SCRIPT));
  bootContainer(container);

  const taskService = container.resolve<TaskService>(TOKENS.TaskService);
  const dispatcher = container.resolve<Dispatcher>(TOKENS.Dispatcher);
  const runner = container.resolve<AgentRunner>(TOKENS.AgentRunner);
  const projectId = await insertProject(db, 'e2e-failure-s5', dir);
  const task = await taskService.createTask({ projectId, title: TITLE, description: DESCRIPTION });

  await dispatcher.dispatchPending();
  await runner.runTask(task.id);

  assert(
    await taskHasState(db, task.id, TaskStatus.AwaitingHumanIntervention),
    's5: task not AWAITING_HUMAN_INTERVENTION',
  );
  const run = await latestRun(db, task.id);
  assert(
    run?.escalation_reason === 'TOKEN_BUDGET_EXCEEDED',
    `s5: escalation_reason = ${run?.escalation_reason}`,
  );
  assert(
    classifyError(new TokenBudgetExceededError(18, 5)).class === 'RESOURCE',
    's5: classifyError(TokenBudgetExceededError) != RESOURCE',
  );

  console.log('[e2e][s5] token budget → RESOURCE + TOKEN_BUDGET_EXCEEDED ✓');
}

/** S6 — a rejection's rationale reaches the next attempt's prompt. */
async function scenario6(): Promise<void> {
  const dir = join(SANDBOX_BASE, 's6-rework-rationale');
  const workDir = join(WORKING_BASE, 's6');
  resetAgentEnv();
  withEnv({ SANDBOX_ROOT: dir, WORKING_REPO_ROOT: workDir });
  prepareSandbox(dir, {
    'tsconfig.json': TS_CONFIG,
    'src/greeting.ts': GREETING_OK,
    'src/greeting.test.ts': GREETING_TEST,
  });
  await prepareWorkingRepo(workDir);

  const container = buildContainer();
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const mock = new MockLLM([...FIX_SCRIPT, ...FIX_SCRIPT]);
  installProvider(container, mock);
  bootContainer(container);
  const app = buildApp(container);
  const dispatchLoop = container.resolve<DispatchLoop>(TOKENS.DispatchLoop);
  const runtimeLoop = container.resolve<RuntimePollLoop>(TOKENS.RuntimePollLoop);

  const rationale = 'the fix is wrong, try again';

  try {
    dispatchLoop.start(100);
    runtimeLoop.start(100);

    const taskId = await postTask(app, dir, TITLE, DESCRIPTION);
    await waitFor(
      () => taskHasState(db, taskId, TaskStatus.AwaitingReview),
      120_000,
      's6: task → AWAITING_REVIEW (attempt 1)',
    );

    const item = await waitForQueueItem(app, taskId, 's6: task routed into the review queue');

    const claim = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${item.id}/claim`,
      payload: { reviewerId: 'e2e-reviewer' },
    });
    assert(claim.statusCode === 200, `s6: claim → ${claim.statusCode}: ${claim.body}`);

    const decide = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${item.id}/decide`,
      payload: { decision: 'REJECT', rationale, wasUseful: true, reviewerId: 'e2e-reviewer' },
    });
    assert(decide.statusCode === 200, `s6: decide → ${decide.statusCode}: ${decide.body}`);

    // Attempt 2 (3 responses in) must open with the reviewer's rationale.
    await waitFor(async () => mock.calls.length >= 4, 30_000, 's6: attempt 2 to start');
    const secondUser = mock.calls[3]?.messages[0]?.content ?? '';
    assert(secondUser.includes(rationale), `s6: rationale absent from prompt: ${secondUser}`);
  } finally {
    dispatchLoop.stop();
    runtimeLoop.stop();
    await Promise.all([dispatchLoop.waitForIdle(), runtimeLoop.waitForIdle()]);
  }

  console.log('[e2e][s6] reject rationale propagated into attempt 2 prompt ✓');
}

/** S7 — a dirty working tree on approve → AWAITING_HUMAN_INTERVENTION, no commit. */
async function scenario7(): Promise<void> {
  const dir = join(SANDBOX_BASE, 's7-merge-conflict');
  const workDir = join(WORKING_BASE, 's7');
  resetAgentEnv();
  withEnv({ SANDBOX_ROOT: dir, WORKING_REPO_ROOT: workDir });
  prepareSandbox(dir, {
    'tsconfig.json': TS_CONFIG,
    'src/greeting.ts': GREETING_OK,
    'src/greeting.test.ts': GREETING_TEST,
  });
  await prepareWorkingRepo(workDir);

  const container = buildContainer();
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  installProvider(container, new MockLLM(FIX_SCRIPT));
  bootContainer(container);
  const app = buildApp(container);
  const dispatchLoop = container.resolve<DispatchLoop>(TOKENS.DispatchLoop);
  const runtimeLoop = container.resolve<RuntimePollLoop>(TOKENS.RuntimePollLoop);

  try {
    dispatchLoop.start(100);
    runtimeLoop.start(100);

    const taskId = await postTask(app, dir, TITLE, DESCRIPTION);
    await waitFor(
      () => taskHasState(db, taskId, TaskStatus.AwaitingReview),
      120_000,
      's7: task → AWAITING_REVIEW',
    );

    const item = await waitForQueueItem(app, taskId, 's7: task routed into the review queue');

    // Dirty the working tree so the merge must refuse to commit.
    writeFileSync(join(workDir, 'dirty.txt'), 'uncommitted change\n');

    const claim = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${item.id}/claim`,
      payload: { reviewerId: 'e2e-reviewer' },
    });
    assert(claim.statusCode === 200, `s7: claim → ${claim.statusCode}: ${claim.body}`);

    const decide = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${item.id}/decide`,
      payload: {
        decision: 'APPROVE',
        rationale: 'lgtm',
        wasUseful: true,
        reviewerId: 'e2e-reviewer',
      },
    });
    assert(decide.statusCode === 200, `s7: decide → ${decide.statusCode}: ${decide.body}`);

    await waitFor(
      () => taskHasState(db, taskId, TaskStatus.AwaitingHumanIntervention),
      30_000,
      's7: task → AWAITING_HUMAN_INTERVENTION',
    );

    assert(!(await anyCommitSha(db, taskId)), 's7: a change was committed despite the conflict');
    assert(!(await anyArtifactMerged(db, taskId)), 's7: artifacts reached MERGED');
  } finally {
    dispatchLoop.stop();
    runtimeLoop.stop();
    await Promise.all([dispatchLoop.waitForIdle(), runtimeLoop.waitForIdle()]);
  }

  console.log('[e2e][s7] merge conflict → AWAITING_HUMAN_INTERVENTION (no commit) ✓');
}

/** S8 — graceful drain joins the in-flight run; no orphaned EXECUTING row. */
async function scenario8(): Promise<void> {
  const dir = join(SANDBOX_BASE, 's8-drain');
  const workDir = join(WORKING_BASE, 's8');
  resetAgentEnv();
  withEnv({ SANDBOX_ROOT: dir, WORKING_REPO_ROOT: workDir });
  prepareSandbox(dir, {
    'tsconfig.json': TS_CONFIG,
    'src/greeting.ts': GREETING_OK,
    'src/greeting.test.ts': GREETING_TEST,
  });
  await prepareWorkingRepo(workDir);

  const container = buildContainer();
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  installProvider(container, new SlowLLM(FIX_SCRIPT, 1200));
  bootContainer(container);
  const app = buildApp(container);
  const dispatchLoop = container.resolve<DispatchLoop>(TOKENS.DispatchLoop);
  const runtimeLoop = container.resolve<RuntimePollLoop>(TOKENS.RuntimePollLoop);

  dispatchLoop.start(100);
  runtimeLoop.start(100);

  try {
    const taskId = await postTask(app, dir, TITLE, DESCRIPTION);
    await waitFor(
      () => taskHasState(db, taskId, TaskStatus.Executing),
      30_000,
      's8: task → EXECUTING',
    );

    // SIGTERM-style shutdown: stop scheduling, then join the in-flight run.
    dispatchLoop.stop();
    runtimeLoop.stop();
    await Promise.all([dispatchLoop.waitForIdle(), runtimeLoop.waitForIdle()]);

    assert(
      !(await taskHasState(db, taskId, TaskStatus.Executing)),
      's8: task orphaned in EXECUTING',
    );
    assert(
      await taskHasState(db, taskId, TaskStatus.AwaitingReview),
      's8: drain abandoned the run before it completed',
    );
  } finally {
    dispatchLoop.stop();
    runtimeLoop.stop();
  }

  console.log('[e2e][s8] graceful drain: no orphaned EXECUTING row ✓');
}

// --- Driver ----------------------------------------------------------------

async function main(): Promise<void> {
  const envPath = join(REPO_ROOT, '.env');
  if (process.env.DATABASE_URL === undefined) {
    config({ path: envPath });
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('[e2e] DATABASE_URL is not set. Copy .env.example to .env (repo root).');
  }

  // Force a deterministic agent for the whole suite.
  delete process.env.ANTHROPIC_API_KEY;

  // One shared connection used only to reset the stack between scenarios. Each
  // scenario is self-contained, but its loop-based siblings (S3/S6/S7/S8) poll
  // the *global* queue — a task left `QUEUED` by an earlier manual scenario
  // would otherwise be claimed by the next scenario's runtime loop (and drain
  // that scenario's scripted MockLLM). Truncating before each scenario keeps the
  // queue empty at its start.
  const preDb = createDb(process.env.DATABASE_URL);

  const scenarios: ReadonlyArray<{ name: string; run: () => Promise<void> }> = [
    { name: 'S1 verification FAILED → REWORK → QUEUED', run: scenario1 },
    { name: 'S2 max attempts → FAILED', run: scenario2 },
    { name: 'S3 flaky → r3-flaky', run: scenario3 },
    { name: 'S4 max steps → escalate', run: scenario4 },
    { name: 'S5 token budget → RESOURCE', run: scenario5 },
    { name: 'S6 reject rationale → rework', run: scenario6 },
    { name: 'S7 merge conflict → intervention', run: scenario7 },
    { name: 'S8 graceful drain', run: scenario8 },
  ];

  for (const scenario of scenarios) {
    await truncateAll(preDb);
    console.log(`[e2e] === ${scenario.name} ===`);
    await scenario.run();
  }

  console.log('[e2e] failure paths: all 8 scenarios passed');
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error('[e2e] FAILED:', err);
    process.exit(1);
  },
);
