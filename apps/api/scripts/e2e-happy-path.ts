/**
 * Day-25 E2E vertical slice: the happy path, end to end, with a scripted agent.
 *
 * This driver boots the real object graph (not mocks apart from the MockLLM),
 * prepares a tiny TypeScript project with a deliberate bug, then drives one task
 * through the whole causal chain:
 *
 *   POST /api/tasks → dispatch → agent (MockLLM) → write_file fix → apply →
 *   verify (compile + vitest) → attention assessment → route → human approve →
 *   merge → COMPLETED
 *
 * It asserts the intermediate records (context snapshot, PASSED verification,
 * evidence, assessment, routed queue item) and — as the Day-25 acceptance calls
 * for — that the persisted `event_log` chain follows the expected causal order.
 *
 * Run via `pnpm e2e` (sets up a clean sandbox + working git repo and truncates
 * the public schema first). Needs `DATABASE_URL` (from `.env` or the env).
 */

import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { config } from 'dotenv';
import { count, desc, eq, sql } from 'drizzle-orm';

import type { RuntimePollLoop } from '@harness/agent-runtime';
import { TOKENS } from '@harness/di';
import {
  agentRuns,
  artifacts,
  assessments,
  changes,
  contexts,
  eventLog,
  evidence,
  shadowRankComparisons,
  tasks,
  users,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { ArtifactStatus, TaskStatus } from '@harness/domain';
import { reconstruct, snapshotInfraCounters } from '@harness/observability';
import type { DispatchLoop } from '@harness/orchestrator';

import { buildApp } from '../src/app.js';
import { bootContainer, buildContainer } from '../src/bootstrap.js';
import { initApiTracing } from '../src/observability.js';

const execFileP = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE_DIR = join(REPO_ROOT, 'fixtures/e2e/happy-path');
const SANDBOX_ROOT = join(REPO_ROOT, 'sandbox/e2e-happy-path');
const WORKING_REPO = join(REPO_ROOT, 'working-repo');

/** Complete the mock OIDC login and return the `sid` cookie (day-02 guarding). */
async function mockLoginCookie(app: ReturnType<typeof buildApp>): Promise<string> {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const location = new URL(login.headers.location!);
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${location.searchParams.get('code')}&state=${location.searchParams.get('state')}`,
  });
  if (callback.statusCode !== 200) {
    throw new Error(`[e2e] mock login failed: ${callback.statusCode}: ${callback.body}`);
  }
  return callback.headers['set-cookie']!.toString().split(';')[0]!;
}

/** The causal milestones whose presence + relative order the run must prove. */
const MILESTONES = [
  'artifact.created',
  'task.execution_finished',
  'verification.completed',
  'attention.assessment_created',
  'attention.item_routed',
  'review.decision_submitted',
  'artifact.merged',
] as const;

interface CreateTaskResponse {
  readonly id: string;
}
interface QueueItemJson {
  readonly id: string;
  readonly taskId: string;
  readonly ruleId: string;
}

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

/** Copy the fixture (buggy `src/` + `tsconfig.json`) into a fresh sandbox dir. */
function prepareSandbox(): void {
  rmSync(SANDBOX_ROOT, { recursive: true, force: true });
  mkdirSync(join(SANDBOX_ROOT, 'src'), { recursive: true });
  cpSync(join(FIXTURE_DIR, 'src'), join(SANDBOX_ROOT, 'src'), { recursive: true });
  copyFileSync(join(FIXTURE_DIR, 'tsconfig.json'), join(SANDBOX_ROOT, 'tsconfig.json'));
}

/** Create a clean git repo the MergeService can commit into (day-24 §2.3). */
async function prepareWorkingRepo(): Promise<void> {
  rmSync(WORKING_REPO, { recursive: true, force: true });
  mkdirSync(WORKING_REPO, { recursive: true });
  writeFileSync(join(WORKING_REPO, 'README.md'), '# harness working repo\n');
  await git(WORKING_REPO, ['init']);
  await git(WORKING_REPO, ['config', 'user.email', 'harness-e2e@example.com']);
  await git(WORKING_REPO, ['config', 'user.name', 'Harness E2E']);
  await git(WORKING_REPO, ['config', 'commit.gpgSign', 'false']);
  await git(WORKING_REPO, ['add', '-A']);
  await git(WORKING_REPO, ['commit', '-m', 'chore: init working repo']);
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileP('git', args, { cwd });
}

/** Truncate every public table except drizzle's migration bookkeeping. */
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

async function taskHasState(db: DrizzleDB, taskId: string, state: TaskStatus): Promise<boolean> {
  const rows = await db
    .select({ state: tasks.state })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return rows[0]?.state === state;
}

async function contextExists(db: DrizzleDB, taskId: string): Promise<boolean> {
  const rows = await db
    .select({ id: contexts.id })
    .from(contexts)
    .where(eq(contexts.task_id, taskId))
    .limit(1);
  return rows.length > 0;
}

async function overallVerdict(db: DrizzleDB, taskId: string): Promise<string | null> {
  const rows = await db
    .select({ overall: verificationReports.overall })
    .from(verificationReports)
    .where(eq(verificationReports.task_id, taskId))
    .orderBy(desc(verificationReports.created_at))
    .limit(1);
  return rows[0]?.overall ?? null;
}

/** The `rank_method` the served context snapshot recorded (day-27 §2.3). */
async function servedRankMethod(db: DrizzleDB, taskId: string): Promise<string | null> {
  const rows = await db
    .select({ rankMethod: contexts.rank_method })
    .from(contexts)
    .where(eq(contexts.task_id, taskId))
    .orderBy(desc(contexts.created_at))
    .limit(1);
  return rows[0]?.rankMethod ?? null;
}

/** Whether the semantic shadow wrote a rank-comparison row for this task (day-27 §2.3). */
async function shadowComparisonExists(db: DrizzleDB, taskId: string): Promise<boolean> {
  const rows = await db
    .select({ id: shadowRankComparisons.id })
    .from(shadowRankComparisons)
    .where(eq(shadowRankComparisons.task_id, taskId))
    .limit(1);
  return rows.length > 0;
}

async function evidenceCount(db: DrizzleDB): Promise<number> {
  const rows = await db.select({ n: count() }).from(evidence);
  return rows[0]?.n ?? 0;
}

async function assessmentExists(db: DrizzleDB, taskId: string): Promise<boolean> {
  const rows = await db
    .select({ id: assessments.id })
    .from(assessments)
    .innerJoin(changes, eq(changes.id, assessments.change_id))
    .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
    .where(eq(agentRuns.task_id, taskId))
    .limit(1);
  return rows.length > 0;
}

async function commitShaIsSet(db: DrizzleDB, taskId: string): Promise<boolean> {
  const rows = await db
    .select({ commitSha: changes.commit_sha })
    .from(changes)
    .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
    .where(eq(agentRuns.task_id, taskId));
  return rows.length > 0 && rows.every((row) => row.commitSha !== null);
}

async function allArtifactsMerged(db: DrizzleDB, taskId: string): Promise<boolean> {
  const rows = await db
    .select({ status: artifacts.status })
    .from(artifacts)
    .innerJoin(changes, eq(changes.artifact_id, artifacts.id))
    .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
    .where(eq(agentRuns.task_id, taskId));
  return rows.length > 0 && rows.every((row) => row.status === ArtifactStatus.Merged);
}

async function eventTypes(db: DrizzleDB): Promise<string[]> {
  const rows = await db.select({ event_type: eventLog.event_type }).from(eventLog);
  return rows.map((row) => row.event_type);
}

/** Confirm every milestone has landed in `event_log`, then check their order. */
async function assertEventChain(db: DrizzleDB): Promise<void> {
  await waitFor(
    async () => {
      const present = new Set(await eventTypes(db));
      return MILESTONES.every((m) => present.has(m));
    },
    10_000,
    'all milestone events persisted',
  );

  const sequence = await eventTypesOrdered(db);
  let cursor = -1;
  for (const milestone of MILESTONES) {
    const idx = sequence.indexOf(milestone);
    assert(idx !== -1, `event "${milestone}" never fired`);
    assert(idx > cursor, `event order violated: "${milestone}" out of causal order`);
    cursor = idx;
  }
  console.log(`[e2e] event chain (${sequence.length} events): ${sequence.join(' → ')}`);
}

async function eventTypesOrdered(db: DrizzleDB): Promise<string[]> {
  const rows = await db
    .select({ event_type: eventLog.event_type })
    .from(eventLog)
    .orderBy(eventLog.occurred_at, eventLog.event_id);
  return rows.map((row) => row.event_type);
}

async function main(): Promise<void> {
  const envPath = join(REPO_ROOT, '.env');
  if (process.env.DATABASE_URL === undefined) {
    config({ path: envPath });
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('[e2e] DATABASE_URL is not set. Copy .env.example to .env (repo root).');
  }

  // Force a deterministic agent: scripted MockLLM, no real key, sandbox + working
  // repo pinned to this run's paths.
  delete process.env.ANTHROPIC_API_KEY;
  process.env.MOCK_LLM_SCRIPT = join(FIXTURE_DIR, 'mock-llm-script.json');
  process.env.SANDBOX_ROOT = SANDBOX_ROOT;
  process.env.WORKING_REPO_ROOT = WORKING_REPO;
  // Opt the semantic shadow in explicitly (day-27 §2.3): with the deterministic
  // StubEmbedder + an empty pgvector index this still writes a comparison row.
  process.env.SEMANTIC_SHADOW_ENABLED = '1';

  // Deterministic identity (day-02): mock OIDC with a fixed subject; the user row
  // seeded below carries the REVIEWER role the guarded review routes require.
  process.env.OIDC_MOCK = 'true';
  process.env.MOCK_OIDC_SUB = 'e2e-reviewer';
  process.env.MOCK_OIDC_EMAIL = 'e2e@example.com';
  process.env.MOCK_OIDC_NAME = 'E2E Reviewer';

  prepareSandbox();
  await prepareWorkingRepo();

  const container = buildContainer();
  // Init the tracing provider + `trace_correlation` write-through BEFORE the app
  // handles any request (day-03 §3.2, mirrors `index.ts`). Without this the
  // dispatcher/agent/verification root spans never map correlation_id → trace_id,
  // and the Day-27 reconstruct would report a null traceId for every task.
  initApiTracing(container);
  const db = container.resolve<DrizzleDB>(TOKENS.Db);
  await truncateAll(db);

  // Seed the REVIEWER principal ahead of the first login so findOrCreateUser
  // preserves (rather than resets) its roles.
  const e2eUserId = 'e2e-user-0000-0000-0000-000000000001';
  await db.insert(users).values({
    id: e2eUserId,
    oidc_sub: 'e2e-reviewer',
    email: 'e2e@example.com',
    display_name: 'E2E Reviewer',
    roles: ['OPERATOR', 'REVIEWER'],
  });

  // Bind subscribers (and decision services) before the first task is created.
  bootContainer(container);

  const app = buildApp(container);
  // Complete a mock login once; every guarded review call rides this session.
  const cookie = await mockLoginCookie(app);
  const dispatchLoop = container.resolve<DispatchLoop>(TOKENS.DispatchLoop);
  const runtimeLoop = container.resolve<RuntimePollLoop>(TOKENS.RuntimePollLoop);
  dispatchLoop.start(100);
  runtimeLoop.start(100);

  try {
    // 1. Create the task through the real HTTP surface.
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        title: 'Fix the greeting bug',
        description: 'Fix the greeting bug in src/greeting.ts so the test passes.',
        repoPath: SANDBOX_ROOT,
      },
    });
    assert(
      createRes.statusCode === 201,
      `POST /api/tasks → ${createRes.statusCode}: ${createRes.body}`,
    );
    const taskId = (createRes.json() as CreateTaskResponse).id;

    // 2. Agent runs, verification passes, task lands in AWAITING_REVIEW.
    await waitFor(
      () => taskHasState(db, taskId, TaskStatus.AwaitingReview),
      180_000,
      'task → AWAITING_REVIEW',
    );

    // 3. The vertical slice produced its intermediate records.
    assert(await contextExists(db, taskId), 'context snapshot was not captured');
    assert((await overallVerdict(db, taskId)) === 'PASSED', 'verification overall != PASSED');
    assert((await evidenceCount(db)) >= 1, 'no evidence rows were recorded');
    // The assessment is written fire-and-forget by `AttentionSubscriber` after the
    // AWAITING_REVIEW transition (day-18 §2.4), so it can lag the state column by a
    // few ms; poll rather than assert-once.
    await waitFor(() => assessmentExists(db, taskId), 10_000, 'assessment created');

    // 4. The task was routed into the review queue via the engine. `AttentionRouter`
    //    enqueues on `attention.assessment_created`, which `AttentionSubscriber`
    //    publishes fire-and-forget a hop *after* the assessment row commits — so
    //    poll the queue item, exactly as we poll the assessment above, rather than
    //    asserting it once (the once-only assert raced this and flaked).
    let item: QueueItemJson | undefined;
    await waitFor(
      async () => {
        const queueRes = await app.inject({
          method: 'GET',
          url: '/api/review/queue',
          headers: { cookie },
        });
        assert(queueRes.statusCode === 200, `GET /api/review/queue → ${queueRes.statusCode}`);
        const queue = queueRes.json() as QueueItemJson[];
        item = queue.find((entry) => entry.taskId === taskId);
        return item !== undefined;
      },
      10_000,
      'task routed into the review queue',
    );
    assert(item !== undefined, 'task was not routed into the review queue');
    assert(item.ruleId.length > 0, 'queue item missing rule_id');

    // 5. Drive the human decision: claim, then approve. Identity rides the session
    //    cookie; the reviewerId the Phase-1 routes read from the body is gone.
    const claimRes = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${item.id}/claim`,
      headers: { cookie },
    });
    assert(claimRes.statusCode === 200, `claim → ${claimRes.statusCode}: ${claimRes.body}`);

    const decideRes = await app.inject({
      method: 'POST',
      url: `/api/review/queue/${item.id}/decide`,
      headers: { cookie },
      payload: {
        decision: 'APPROVE',
        rationale: 'the fix is correct',
        wasUseful: true,
      },
    });
    assert(decideRes.statusCode === 200, `decide → ${decideRes.statusCode}: ${decideRes.body}`);

    // 6. Merge closes the loop: commit, MERGED artifacts, COMPLETED task.
    await waitFor(() => taskHasState(db, taskId, TaskStatus.Completed), 30_000, 'task → COMPLETED');
    assert(await commitShaIsSet(db, taskId), 'commit_sha was not set by merge');
    assert(await allArtifactsMerged(db, taskId), 'not all artifacts reached MERGED');

    // 7. The event log proves the causal chain, in order.
    await assertEventChain(db);

    // 8. Day-27 telemetry reconstruction: the run is attributable end-to-end
    //    (Spec 10). `reconstruct` throws on the two integrity invariants it owns
    //    (attributed review, hashed verification); here we additionally assert
    //    the parts only the E2E driver knows about: the trace mapping exists for
    //    THIS task, the served rank stayed on the Phase-1 keyword path, the
    //    semantic shadow wrote its comparison row, and the context cache moved.
    const run = await reconstruct(db, taskId);
    assert(run.traceId !== null, 'trace_correlation did not map correlation_id → trace_id');
    assert(run.events.length > 0, 'event_log replay empty');
    assert(run.decisions.length > 0, 'no decision history in telemetry');
    assert(run.verifications.length > 0, 'no verification history in telemetry');
    assert(
      (await servedRankMethod(db, taskId)) === 'phase1-keyword-dependency',
      'served rank_method drifted off the Phase-1 keyword path',
    );
    assert(await shadowComparisonExists(db, taskId), 'no shadow_rank_comparisons row written');

    // The vertical slice reads context sources at least once (day-20 §3.4).
    const counters = snapshotInfraCounters();
    assert(counters.cacheHits + counters.cacheMisses >= 1, 'context cache counters did not move');

    console.log('[e2e] happy path passed');
    console.log(
      `[e2e] reconstructed ${run.events.length} events, ${run.decisions.length} decisions, ${run.verifications.length} verifications (trace ${run.traceId})`,
    );
    console.log(
      `[e2e] infra counters: cacheHit=${counters.cacheHits} cacheMiss=${counters.cacheMisses} ` +
        `sandboxRun=${counters.sandboxRuns} sandboxFallback=${counters.sandboxFallbacks} ` +
        `objectIntegrityError=${counters.objectIntegrityErrors}`,
    );
  } finally {
    dispatchLoop.stop();
    runtimeLoop.stop();
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error('[e2e] FAILED:', err);
    process.exit(1);
  },
);
