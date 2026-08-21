/**
 * `ReworkService` (day-24 §2.2) — closes the reject path.
 *
 * When a task reaches `REJECTED`, the rework service either loops it back for
 * another attempt (`REJECTED → REWORK`, carrying the reviewer's rationale so the
 * next attempt can see it) or, once `attempt_number >= max_attempts`, fails it
 * terminally (`REJECTED → FAILED`) and publishes `task.failed`.
 *
 * The rationale is *data*, persisted on the `REWORK` transition's history row
 * (day-24 §6), not a free-text blob — the AgentRunner reads it back into the next
 * attempt's prompt.
 */

import { and, desc, eq } from 'drizzle-orm';

import { taskStateHistory } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { brand, EventType, TaskStatus } from '@harness/domain';
import type { TaskFailedPayload, TaskID, TaskStateChangedPayload } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { TaskService } from '@harness/orchestrator';

export class ReworkService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly taskService: TaskService,
  ) {}

  /** Attach the REJECTED handler; returns nothing (fire-and-forget). */
  subscribe(): void {
    this.bus.subscribe<TaskStateChangedPayload>(EventType.TaskStateChanged, (event) => {
      if (event.payload.to_state !== TaskStatus.Rejected) {
        return;
      }
      void this.onRejected(event.payload.task_id).catch((error) => {
        console.error('[rework] reject follow-through failed:', error);
      });
    });
  }

  /** Re-queue for another attempt, or fail terminally at `max_attempts`. */
  async onRejected(taskId: TaskID): Promise<void> {
    const task = await this.taskService.getTask(taskId);
    if (!task || task.state !== TaskStatus.Rejected) {
      return;
    }

    if (task.attemptNumber >= task.maxAttempts) {
      await this.taskService.transitionTask(taskId, TaskStatus.Failed, 'orchestrator', {
        expectedFrom: TaskStatus.Rejected,
        rationale: `max attempts exhausted (${task.maxAttempts})`,
      });
      const payload: TaskFailedPayload = { task_id: taskId, reason: 'MAX_ATTEMPTS_EXHAUSTED' };
      this.bus.publish(createEvent(EventType.TaskFailed, brand(taskId, 'CorrelationID'), payload));
      return;
    }

    const rationale = await this.latestRejectionRationale(taskId);
    await this.taskService.transitionTask(taskId, TaskStatus.Rework, 'orchestrator', {
      expectedFrom: TaskStatus.Rejected,
      rationale: rationale ?? 'human review rejected the change',
    });
  }

  /** The reviewer's rationale recorded on this task's most recent rejection. */
  private async latestRejectionRationale(taskId: TaskID): Promise<string | null> {
    const rows = await this.db
      .select({ rationale: taskStateHistory.rationale })
      .from(taskStateHistory)
      .where(
        and(
          eq(taskStateHistory.task_id, taskId),
          eq(taskStateHistory.to_state, TaskStatus.Rejected),
        ),
      )
      .orderBy(desc(taskStateHistory.occurred_at))
      .limit(1);
    return rows[0]?.rationale ?? null;
  }
}
