/**
 * Startup orphan reconciler (day-28 §2.2 F4).
 *
 * Until today, SIGTERM (graceful) was handled but SIGKILL left tasks stranded
 * mid-flight. On boot — a single-writer moment, before any dispatcher or runtime
 * loop starts — this walks every `EXECUTING`/`VERIFYING` task and fails it toward
 * human attention (`AWAITING_HUMAN_INTERVENTION`) with reason `PROCESS_DIED`.
 *
 * This is the **only** sanctioned auto-"repair" in Phase 1, and it never does
 * the work a human would do: it does not re-run, re-queue, or decide anything.
 * It just escorts an abandoned task off the in-flight states so a human can look
 * at it — consistent with the Day-27 "smoke alarm, not a fixer" philosophy (Q8).
 *
 * Every recovery goes through {@link TaskService.transitionTask}, so the normal
 * audit trail (`task_state_history` + `task.state_changed`) still applies, and a
 * dedicated `task.orphan_recovered` event marks the recovery for the cookbook.
 */

import { inArray } from 'drizzle-orm';

import { tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { Logger } from '@harness/di';
import { brand, EventType, TaskStatus } from '@harness/domain';
import type { TaskOrphanRecoveredPayload, TaskStatus as TaskState } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import type { TaskService } from '@harness/orchestrator';

/** The in-flight states that can strand a task on a non-graceful crash. */
const ORPHAN_STATES = [TaskStatus.Executing, TaskStatus.Verifying] as const;

/**
 * Recover every orphaned in-flight task. Returns how many were recovered, so the
 * boot log can state it plainly at startup.
 */
export async function reconcileOrphans(
  db: DrizzleDB,
  taskService: TaskService,
  bus: IEventBus,
  logger: Logger,
): Promise<number> {
  const orphans = await db
    .select({ id: tasks.id, state: tasks.state })
    .from(tasks)
    .where(inArray(tasks.state, [...ORPHAN_STATES]));

  for (const orphan of orphans) {
    const taskId = brand(orphan.id, 'TaskID');
    const fromState = orphan.state as TaskState;

    await taskService.transitionTask(taskId, TaskStatus.AwaitingHumanIntervention, 'orchestrator', {
      expectedFrom: fromState,
      rationale: 'PROCESS_DIED',
    });

    const payload: TaskOrphanRecoveredPayload = {
      task_id: taskId,
      from_state: fromState,
      reason: 'PROCESS_DIED',
    };
    bus.publish(
      createEvent(EventType.TaskOrphanRecovered, brand(orphan.id, 'CorrelationID'), payload),
    );

    logger.warn('orphaned task recovered at startup', {
      task_id: orphan.id,
      from_state: fromState,
    });
  }

  return orphans.length;
}
