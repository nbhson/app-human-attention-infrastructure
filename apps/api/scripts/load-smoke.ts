/**
 * Day-28 §2.3 — load smoke test (`pnpm load:smoke`).
 *
 * Pushes 50 tasks through the *real* pipeline — real Dispatcher, AgentRunner
 * (scripted MockLLM, no API key), real compile/test verification, real attention
 * routing — and asserts the smoke invariants, not benchmarks:
 *
 *   - no orphaned `EXECUTING`/`VERIFYING` row (Q8)
 *   - no task stuck in a non-terminal state
 *   - `review_queue` depth matches the drain expectation
 *   - `event_log` count stays bounded (< 40 events/task on average)
 *   - wall-clock is reported but never tuned
 *
 * Scenario mix (50 tasks):
 *   - 30 happy path      → AWAITING_REVIEW (agent fixes `src/greeting.ts`)
 *   - 10 verify-fail-rework → REWORK then AWAITING_REVIEW on attempt 2
 *   -  5 flaky           → AWAITING_REVIEW with rule `r3-flaky`
 *   -  5 max-steps       → AWAITING_HUMAN_INTERVENTION (MAX_STEPS_EXCEEDED)
 *
 * Phase-1 reality (documented in `docs/runbook/limitations.md`): there is **one
 * shared sandbox** for the whole process, so concurrent *execution* of the
 * verification worker is not safe (two `tsc`/`vitest` runs over the same tree).
 * Concurrency is therefore exercised on the **dispatch** path — two Dispatchers
 * + two RuntimePollLoops racing `SKIP LOCKED` across the 30 happy-path tasks —
 * while the failure/retry scenarios (rework, flaky, max-steps) are driven
 * deterministically one task at a time, mirroring the Day-26 E2E failure suite.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { count, inArray, sql } from 'drizzle-orm';

import {
  LoggingLLMProvider,
  mockTextResponse,
  mockToolCallResponse,
  RuntimePollLoop,
} from '@harness/agent-runtime';
import type {
  AgentRunner,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  MockScript,
} from '@harness/agent-runtime';
import { TOKENS } from '@harness/di';
import type { Logger } from '@harness/di';
import { eventLog, projects, reviewQueue, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { newProjectID, TaskStatus } from '@harness/domain';
import type { TaskID } from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';
import { Dispatcher, DispatchLoop, TaskService } from '@harness/orchestrator';

import { bootContainer, buildContainer } from '../src/bootstrap.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SANDBOX_ROOT = join(REPO_ROOT, 'sandbox/load-smoke');
const WORKING_REPO_ROOT = join(REPO_ROOT, 'working-repo/load-smoke');
const FLAKY_ROOT = join(SANDBOX_ROOT, 'flaky');

const TITLE = 'Fix the greeting bug';
const DESCRIPTION = 'Fix the greeting bug in src/greeting.ts so the test passes.';

/** Terminal states — a task in none of these is "stuck" (or still in flight). */
const IN_FLIGHT = new Set<string>([
  TaskStatus.Pending,
  TaskStatus.Queued,
  TaskStatus.Executing,
  TaskStatus.Verifying,
  TaskStatus.Rework,
]);

// --- Scripted-agent fixtures (deterministic, no real key) -------------------

const GREETING_OK = `/** A tiny greeting helper. */\nexport function greeting(name: string): string {\n  return \`Hello, \${name.toLowerCase()}!\`;\n}\n`;

const GREETING_BROKEN = `/** A tiny greeting helper (broken by the agent). */\nexport function greeting(name: string): string {\n  return \`Hello, \${name.toLowercase()}!\`;\n}\n`;

const GREETING_TEST = `import { describe, expect, it } from 'vitest';\n\nimport { greeting } from './greeting';\n\ndescribe('greeting', () => {\n  it('greets with a lowercased name', () => {\n    expect(greeting('ADA')).toBe('Hello, ada!');\n  });\n});\n`;

// Flaky by construction: the counter file lives in the worktree, so the first
// vitest run reads 0 (fails `expect(n).toBe(1)`), the retry reads 1 (passes).
const FLAKY_TEST = `import { existsSync, readFileSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { expect, it } from 'vitest';\n\nconst counterPath = join(process.cwd(), '.flaky-counter.txt');\nconst n = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;\nwriteFileSync(counterPath, String(n + 1));\n\nit('passes on the retry', () => {\n  expect(n).toBe(1);\n});\n`;

const TS_CONFIG = `{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "moduleResolution": "Bundler",\n    "strict": true,\n    "skipLibCheck": true,\n    "noEmit": true,\n    "types": []\n  },\n  "include": ["src"]\n}\n`;

// Node types must be visible or the flaky test's `node:fs` import fails compile.
const TS_CONFIG_NODE = `{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "moduleResolution": "Bundler",\n    "strict": true,\n    "skipLibCheck": true,\n    "noEmit": true,\n    "types": ["node"]\n  },\n  "include": ["src"]\n}\n`;

// Pins Vitest to the flaky worktree's own suite (see Day-26 S3 rationale): the
// monorepo root config only includes packages/apps tests, so a bare worktree
// would otherwise report "no tests" and pass vacuously.
const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  test: {\n    include: ['src/**/*.test.ts'],\n    environment: 'node',\n  },\n});\n`;

const FIX_SCRIPT: MockScript = [
  mockToolCallResponse('read_file', 'c1', { path: 'src/greeting.ts' }),
  mockToolCallResponse('write_file', 'c2', { path: 'src/greeting.ts', content: GREETING_OK }),
  mockTextResponse('Fixed the greeting helper.'),
];

const BREAK_SCRIPT: MockScript = [
  mockToolCallResponse('read_file', 'c1', { path: 'src/greeting.ts' }),
  mockToolCallResponse('write_file', 'c2', { path: 'src/greeting.ts', content: GREETING_BROKEN }),
  mockTextResponse('Broke the greeting helper.'),
];

// 12 read-only turns with no end_turn → exceeds the default 10-step budget.
const MAX_STEPS_SCRIPT: MockScript = Array.from({ length: 12 }, (_, i) =>
  mockToolCallResponse('read_file', `c${i}`, { path: 'src/greeting.ts' }),
);

// --- A provider that serves each task its own script (concurrency-safe) -----

class StagedLLM implements LLMProvider {
  private readonly scripts = new Map<string, MockScript>();
  public calls = 0;

  /** Register the script a task's agent will consume across its attempts. */
  add(taskId: string, script: MockScript): void {
    this.scripts.set(taskId, [...script]);
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    this.calls += 1;
    const taskId = req.correlation_id;
    if (!taskId) {
      throw new Error('StagedLLM: request missing correlation_id');
    }
    const queue = this.scripts.get(taskId);
    if (!queue) {
      throw new Error(`StagedLLM: no script for task ${taskId}`);
    }
    const next = queue.shift();
    if (!next) {
      throw new Error(`StagedLLM: script exhausted for task ${taskId}`);
    }
    return next;
  }
}

// --- Shared helpers ---------------------------------------------------------

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`[load-smoke] ${msg}`);
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
  throw new Error(`[load-smoke] timed out waiting for ${label}`);
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

/** Write a fixture tree (relative path → content) into a fresh sandbox dir. */
function prepareSandbox(dir: string, files: Record<string, string>): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
}

function prepareSharedSandbox(): void {
  prepareSandbox(SANDBOX_ROOT, {
    'tsconfig.json': TS_CONFIG,
    'src/greeting.ts': GREETING_BROKEN,
    'src/greeting.test.ts': GREETING_TEST,
  });
}

function prepareFlakySandbox(i: number): string {
  const dir = join(FLAKY_ROOT, String(i));
  prepareSandbox(dir, {
    'tsconfig.json': TS_CONFIG_NODE,
    'vitest.config.ts': VITEST_CONFIG,
    'src/flaky.test.ts': FLAKY_TEST,
  });
  return dir;
}

async function taskState(db: DrizzleDB, taskId: string): Promise<string | undefined> {
  const rows = await db
    .select({ state: tasks.state })
    .from(tasks)
    .where(sql`${tasks.id} = ${taskId}`)
    .limit(1);
  return rows[0]?.state;
}

async function countOrphans(db: DrizzleDB): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(tasks)
    .where(inArray(tasks.state, [TaskStatus.Executing, TaskStatus.Verifying]));
  return rows[0]?.n ?? 0;
}

// --- Driver -----------------------------------------------------------------

async function main(): Promise<void> {
  const envPath = join(REPO_ROOT, '.env');
  if (process.env.DATABASE_URL === undefined) {
    config({ path: envPath });
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('[load-smoke] DATABASE_URL is not set. Copy .env.example to .env.');
  }

  // Deterministic, key-free agent for the whole run.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AGENT_MAX_STEPS;

  const startedWallClock = Date.now();

  // Working repo dir must exist so the (unused) GitAdapter never ENOENTs; no
  // merge happens in a smoke drain (no human approve), so no git init needed.
  mkdirSync(WORKING_REPO_ROOT, { recursive: true });
  mkdirSync(SANDBOX_ROOT, { recursive: true });
  process.env.SANDBOX_ROOT = SANDBOX_ROOT;
  process.env.WORKING_REPO_ROOT = WORKING_REPO_ROOT;

  const staged = new StagedLLM();

  const container = buildContainer();
  container.register(
    TOKENS.LLMProvider,
    (c) => new LoggingLLMProvider(staged, c.resolve<DrizzleDB>(TOKENS.Db)),
  );
  bootContainer(container);

  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  const bus = container.resolve<IEventBus>(TOKENS.EventBus);
  const logger = container.resolve<Logger>(TOKENS.Logger);
  const taskService = container.resolve<TaskService>(TOKENS.TaskService);
  const runner = container.resolve<AgentRunner>(TOKENS.AgentRunner);

  await truncateAll(db);

  const dispatcher = new Dispatcher(db, taskService, bus);
  // Two dispatchers + two runtime loops race SKIP LOCKED over the happy-path batch.
  const dispatchLoops = [
    new DispatchLoop(dispatcher, logger),
    new DispatchLoop(new Dispatcher(db, taskService, bus), logger),
  ];
  const runtimeLoops = [
    new RuntimePollLoop(db, runner, logger),
    new RuntimePollLoop(db, runner, logger),
  ];

  async function seedTask(repoPath: string, script: MockScript, name: string): Promise<TaskID> {
    const projectId = newProjectID();
    await db.insert(projects).values({ id: projectId, name, repo_path: repoPath });
    const task = await taskService.createTask({
      projectId,
      title: TITLE,
      description: DESCRIPTION,
    });
    staged.add(task.id, script);
    return task.id;
  }

  const happy: TaskID[] = [];
  const rework: TaskID[] = [];
  const flaky: TaskID[] = [];
  const maxSteps: TaskID[] = [];

  // --- Phase A: 30 happy-path tasks via concurrent loops ---------------------
  prepareSharedSandbox();
  for (let i = 0; i < 30; i += 1) {
    happy.push(await seedTask(SANDBOX_ROOT, FIX_SCRIPT, `smoke-happy-${i}`));
  }
  for (const loop of [...dispatchLoops, ...runtimeLoops]) {
    loop.start(100);
  }
  await waitFor(
    async () =>
      (await Promise.all(happy.map((id) => taskState(db, id)))).every(
        (s) => s === TaskStatus.AwaitingReview,
      ),
    180_000,
    'happy path drain → AWAITING_REVIEW',
  );
  for (const loop of [...dispatchLoops, ...runtimeLoops]) {
    loop.stop();
  }
  await Promise.all([...dispatchLoops, ...runtimeLoops].map((loop) => loop.waitForIdle()));

  // --- Phase B: 10 verify-fail → REWORK → next-attempt PASS (deterministic) --
  prepareSharedSandbox();
  for (let i = 0; i < 10; i += 1) {
    rework.push(
      await seedTask(SANDBOX_ROOT, [...BREAK_SCRIPT, ...FIX_SCRIPT], `smoke-rework-${i}`),
    );
  }
  const d0 = await dispatcher.dispatchPending(100);
  assert(d0.dispatched === 10, `rework dispatch #1 dispatched ${d0.dispatched}`);
  for (const id of rework) {
    await runner.runTask(id); // attempt 0: breaks the greeting → verify FAILED → REWORK
  }
  const d1 = await dispatcher.dispatchPending(100);
  assert(d1.dispatched === 10, `rework re-dispatch dispatched ${d1.dispatched}`);
  for (const id of rework) {
    await runner.runTask(id); // attempt 1: fixes the greeting → verify PASSED → AWAITING_REVIEW
  }

  // --- Phase C: 5 flaky tasks (unique worktrees, deterministic counters) ------
  for (let i = 0; i < 5; i += 1) {
    const repoPath = prepareFlakySandbox(i);
    flaky.push(await seedTask(repoPath, FIX_SCRIPT, `smoke-flaky-${i}`));
  }
  const d2 = await dispatcher.dispatchPending(100);
  assert(d2.dispatched === 5, `flaky dispatch dispatched ${d2.dispatched}`);
  for (const id of flaky) {
    await runner.runTask(id);
  }

  // --- Phase D: 5 max-steps escalations -------------------------------------
  prepareSharedSandbox();
  for (let i = 0; i < 5; i += 1) {
    maxSteps.push(await seedTask(SANDBOX_ROOT, MAX_STEPS_SCRIPT, `smoke-maxsteps-${i}`));
  }
  const d3 = await dispatcher.dispatchPending(100);
  assert(d3.dispatched === 5, `max-steps dispatch dispatched ${d3.dispatched}`);
  for (const id of maxSteps) {
    await runner.runTask(id);
  }

  // --- Smoke assertions -----------------------------------------------------
  const orphans = await countOrphans(db);
  assert(orphans === 0, `Q8 orphan query returned ${orphans} in-flight task(s)`);

  const all = await db.select({ state: tasks.state }).from(tasks);
  const stuck = all.filter((row) => IN_FLIGHT.has(row.state));
  assert(stuck.length === 0, `${stuck.length} task(s) stuck in a non-terminal/in-flight state`);

  const queueRows = await db.select({ n: count() }).from(reviewQueue);
  const queueDepth = queueRows[0]?.n ?? 0;
  // 30 happy + 10 rework survivors + 5 flaky all route once → 45.
  assert(queueDepth === 45, `review_queue depth = ${queueDepth}, expected 45`);

  const awiRows = await db
    .select({ n: count() })
    .from(tasks)
    .where(sql`${tasks.state} = ${TaskStatus.AwaitingHumanIntervention}`);
  assert((awiRows[0]?.n ?? 0) === 5, 'expected exactly 5 AWAITING_HUMAN_INTERVENTION tasks');

  const eventRows = await db.select({ n: count() }).from(eventLog);
  const eventCount = eventRows[0]?.n ?? 0;
  assert(eventCount < 40 * 50, `event storm: ${eventCount} events for 50 tasks`);

  // The 5 flaky tasks deterministically land under the flaky rule (Day-26 S3).
  const flakyRules = await db
    .select({ rule_id: reviewQueue.rule_id })
    .from(reviewQueue)
    .where(inArray(reviewQueue.task_id, [...flaky]));
  const flakyRuleSet = new Set(flakyRules.map((row) => row.rule_id));
  assert(
    flakyRuleSet.size === 1 && flakyRuleSet.has('r3-flaky'),
    `expected flaky tasks to route via r3-flaky, got [${[...flakyRuleSet].join(', ')}]`,
  );

  // --- Summary --------------------------------------------------------------
  const durations = (
    await db.select({ created: tasks.created_at, updated: tasks.updated_at }).from(tasks)
  )
    .map((row) => new Date(row.updated).getTime() - new Date(row.created).getTime())
    .sort((a, b) => a - b);
  const pct = (q: number): number =>
    durations[Math.min(durations.length - 1, Math.floor(q * durations.length))] ?? 0;

  const wallClock = Date.now() - startedWallClock;

  console.log('\n[load-smoke] summary');
  console.log('  scenario                  seeded   state');
  console.log(`  happy path                    ${happy.length}   AWAITING_REVIEW`);
  console.log(`  verify-fail-then-rework       ${rework.length}   AWAITING_REVIEW`);
  console.log(`  flaky                         ${flaky.length}   AWAITING_REVIEW (r3-flaky)`);
  console.log(`  max-steps escalation          ${maxSteps.length}   AWAITING_HUMAN_INTERVENTION`);
  console.log('  -------------------------------------------');
  console.log(`  total                        50`);
  console.log(`  task duration p50/p95 (ms)   ${pct(0.5)} / ${pct(0.95)}`);
  console.log(`  LLM calls (total)            ${staged.calls}`);
  console.log(`  event_log rows               ${eventCount}`);
  console.log(`  review_queue depth           ${queueDepth}`);
  console.log(`  orphans (Q8)                 ${orphans}`);
  console.log(`  wall-clock (s)               ${(wallClock / 1000).toFixed(1)}`);
  console.log('[load-smoke] passed\n');
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error('[load-smoke] FAILED:', err);
    process.exit(1);
  },
);
