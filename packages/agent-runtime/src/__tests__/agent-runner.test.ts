import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AgentRunStatus, EventType, newProjectID, newTaskID, TaskStatus } from '@harness/domain';
import type {
  EventEnvelope,
  TaskExecutionFinishedPayload,
  TaskID,
  TaskStatus as TaskState,
  TaskTrigger,
} from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';
import { agentRuns, projects, tasks, trajectorySteps } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { MockLLM, mockTextResponse, mockToolCallResponse } from '../llm/mock-llm.js';
import { AgentRunner } from '../runner/agent-runner.js';
import type {
  CompletionHandoff,
  ContextPromptProvider,
  TaskSnapshot,
  TaskTransitionService,
} from '../runner/agent-runner.js';
import { ToolRegistry, noopTool } from '../tools/tool-registry.js';
import { ToolAllowlist } from '../tools/tool-allowlist.js';
import { TrajectoryRecorder } from '../trajectory/trajectory-recorder.js';

/** A bus that records every published envelope, for spy assertions. */
class RecordingBus implements IEventBus {
  readonly published: EventEnvelope[] = [];

  publish<T>(event: EventEnvelope<T>): void {
    this.published.push(event);
  }

  subscribe<T>(_eventType: EventType, _handler: EventHandler<T>): UnsubscribeFn {
    void _eventType;
    void _handler;
    return () => {};
  }
}

/** A structural TaskService that reads/writes the real `tasks` table. */
class FakeTaskService implements TaskTransitionService {
  constructor(private readonly db: DrizzleDB) {}

  async getTask(taskId: TaskID): Promise<TaskSnapshot | null> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    const row = rows[0];
    return row
      ? { title: row.title, description: row.description, attemptNumber: row.attempt_number }
      : null;
  }

  async transitionTask(
    taskId: TaskID,
    toState: TaskState,
    triggeredBy: TaskTrigger,
  ): Promise<unknown> {
    void triggeredBy;
    await this.db.update(tasks).set({ state: toState }).where(eq(tasks.id, taskId));
    return undefined;
  }
}

const SCHEMA = 'harness_test_agent_runner';
const PROJECT = newProjectID();

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await testDb.db.delete(trajectorySteps);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
  await testDb.db.insert(projects).values({ id: PROJECT, name: 'test', repo_path: '/tmp/test' });
});

async function insertQueuedTask(): Promise<TaskID> {
  const id = newTaskID();
  await testDb.db.insert(tasks).values({
    id,
    project_id: PROJECT,
    title: 'agent task',
    description: 'do the thing',
    state: TaskStatus.Queued,
    attempt_number: 0,
    idempotency_key: `${id}:0`,
  });
  return id;
}

async function readTaskState(id: TaskID): Promise<string | null> {
  const rows = await testDb.db.select().from(tasks).where(eq(tasks.id, id));
  return rows[0]?.state ?? null;
}

function makeHandoff(): { handoff: CompletionHandoff; calls: TaskID[] } {
  const calls: TaskID[] = [];
  const handoff: CompletionHandoff = {
    async runLinearWorkflow(taskId: TaskID): Promise<void> {
      calls.push(taskId);
    },
  };
  return { handoff, calls };
}

function buildRunner(
  llm: MockLLM,
  maxSteps: number,
  tokenLimit: number,
  handoff: CompletionHandoff,
  contextPrompt?: ContextPromptProvider,
): { runner: AgentRunner; bus: RecordingBus } {
  const bus = new RecordingBus();
  const tools = new ToolRegistry(new ToolAllowlist(new Set(['noop'])));
  tools.register(noopTool);
  const runner = new AgentRunner(
    testDb.db,
    bus,
    llm,
    tools,
    new FakeTaskService(testDb.db),
    handoff,
    maxSteps,
    tokenLimit,
    new TrajectoryRecorder(testDb.db),
    contextPrompt,
  );
  return { runner, bus };
}

describe('AgentRunner', () => {
  it('runs a QUEUED task to COMPLETED, publishes the result, and hands off', async () => {
    const taskId = await insertQueuedTask();
    const { handoff, calls } = makeHandoff();
    const llm = new MockLLM([mockTextResponse('all done')]);
    const { runner, bus } = buildRunner(llm, 10, 50_000, handoff);

    await runner.runTask(taskId);

    // The runtime claims the task (QUEUED → EXECUTING) and leaves it there; the
    // completion handoff owns the next transition.
    expect(await readTaskState(taskId)).toBe(TaskStatus.Executing);

    const runs = await testDb.db.select().from(agentRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      task_id: taskId,
      status: AgentRunStatus.Completed,
      steps_used: 0,
      current_step: 0,
      escalation_reason: null,
    });

    const finished = bus.published.find(
      (event) => event.event_type === EventType.TaskExecutionFinished,
    );
    expect(finished).toBeDefined();
    const payload = finished?.payload as TaskExecutionFinishedPayload;
    expect(payload.outcome).toBe('COMPLETED');
    expect(payload.task_id).toBe(taskId);
    expect(payload.agent_run_id).toBe(runs[0]?.id);

    expect(calls).toEqual([taskId]);
  });

  it('escalates on max_steps: agent_runs ESCALATED + task AWAITING_HUMAN_INTERVENTION', async () => {
    const taskId = await insertQueuedTask();
    const { handoff } = makeHandoff();
    const llm = new MockLLM([
      mockToolCallResponse('noop', 'c1', {}),
      mockToolCallResponse('noop', 'c2', {}),
    ]);
    const { runner, bus } = buildRunner(llm, 2, 50_000, handoff);

    await runner.runTask(taskId);

    expect(await readTaskState(taskId)).toBe(TaskStatus.AwaitingHumanIntervention);

    const runs = await testDb.db.select().from(agentRuns);
    expect(runs[0]).toMatchObject({
      status: AgentRunStatus.Escalated,
      escalation_reason: 'MAX_STEPS_EXCEEDED',
    });

    const finished = bus.published.find(
      (event) => event.event_type === EventType.TaskExecutionFinished,
    );
    expect((finished?.payload as TaskExecutionFinishedPayload).outcome).toBe('ESCALATED');
  });

  it('escalates with TOKEN_BUDGET_EXCEEDED when the budget is overrun', async () => {
    const taskId = await insertQueuedTask();
    const { handoff } = makeHandoff();
    const llm = new MockLLM([mockTextResponse('boom', 100, 0)]);
    const { runner, bus } = buildRunner(llm, 10, 50, handoff);

    await runner.runTask(taskId);

    expect(await readTaskState(taskId)).toBe(TaskStatus.AwaitingHumanIntervention);

    const runs = await testDb.db.select().from(agentRuns);
    expect(runs[0]).toMatchObject({
      status: AgentRunStatus.Escalated,
      escalation_reason: 'TOKEN_BUDGET_EXCEEDED',
    });

    const finished = bus.published.find(
      (event) => event.event_type === EventType.TaskExecutionFinished,
    );
    expect((finished?.payload as TaskExecutionFinishedPayload).outcome).toBe('ESCALATED');
  });

  it('appends the injected context prompt to the system prompt (day-21 §2.2 seam)', async () => {
    const taskId = await insertQueuedTask();
    const { handoff } = makeHandoff();
    const llm = new MockLLM([mockTextResponse('all done')]);
    const context = '## Project Context\n## Task\n## Relevant Files (ranked, budgeted)\n';
    const contextPrompt: ContextPromptProvider = async () => context;
    const { runner } = buildRunner(llm, 10, 50_000, handoff, contextPrompt);

    await runner.runTask(taskId);

    expect(llm.calls).toHaveLength(1);
    const systemPrompt = llm.calls[0]?.systemPrompt ?? '';
    expect(systemPrompt).toContain('You are a focused coding agent');
    expect(systemPrompt).toContain(context);
  });
});
