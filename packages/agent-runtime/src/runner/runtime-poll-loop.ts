/**
 * `RuntimePollLoop` (day-12 §2.5) — the coroutine that pulls `QUEUED` tasks and
 * hands them to {@link AgentRunner}.
 *
 * Structurally identical to the Orchestrator's `DispatchLoop` (day-08 §2.5): a
 * `setInterval` with an in-flight guard, claiming one task per tick out of a
 * `FOR UPDATE SKIP LOCKED` transaction so concurrent pollers never double-run a
 * task. The difference is intent — the Dispatcher *queues*; this loop *executes*.
 */

import { asc, eq } from 'drizzle-orm';

import { brand, TaskStatus } from '@harness/domain';
import type { TaskID } from '@harness/domain';
import { tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import type { AgentRunner } from './agent-runner.js';

/** The two log levels the loop emits; injectable for tests. */
export interface RuntimePollLoopLogger {
  debug(message: string, ...args: unknown[]): void;
  error(error: Error): void;
}

const DEFAULT_INTERVAL_MS = 2000;

export class RuntimePollLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    private readonly db: DrizzleDB,
    private readonly runner: AgentRunner,
    private readonly logger: RuntimePollLoopLogger = console,
  ) {}

  /** Whether the loop is currently armed. */
  get running(): boolean {
    return this.timer !== null;
  }

  /** Begin polling every `intervalMs`. A no-op if already running. */
  start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.poll();
    }, intervalMs);
  }

  /** Stop polling. An in-flight poll (if any) is allowed to finish. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Resolve once any in-flight execution drains. `stop()` only clears the timer;
   * it does not join the currently-running tick. The graceful-shutdown path
   * awaits this so a SIGTERM never aborts a task mid-execution, leaving it
   * orphaned in `EXECUTING` (day-26 §2.1 scenario 8).
   */
  async waitForIdle(): Promise<void> {
    while (this.inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Atomically claim the oldest `QUEUED` task, or `null` when the queue is empty. */
  async claimQueuedTask(): Promise<TaskID | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.state, TaskStatus.Queued))
        .orderBy(asc(tasks.created_at))
        .limit(1)
        .for('update', { skipLocked: true });
      const row = rows[0];
      return row ? brand(row.id, 'TaskID') : null;
    });
  }

  private async poll(): Promise<void> {
    if (this.inFlight) {
      return; // previous tick still running — skip rather than stack up.
    }
    this.inFlight = true;
    try {
      const taskId = await this.claimQueuedTask();
      if (!taskId) {
        this.logger.debug('runtime poll: no queued task');
        return;
      }
      await this.runner.runTask(taskId);
      this.logger.debug('runtime poll: executed task', { taskId });
    } catch (error) {
      // A transient/agent failure must not kill the loop (day-12 §3.5).
      this.logger.error(error as Error);
    } finally {
      this.inFlight = false;
    }
  }
}
