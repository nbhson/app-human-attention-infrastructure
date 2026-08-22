/**
 * `MergeService` (day-24 §2.1) — closes the approve path.
 *
 * When a task reaches `APPROVED`, the merge service applies the attempt's
 * snapshot contents to the working repo (via the injected {@link GitAdapter}),
 * records the commit SHA on the change, marks the artifacts `MERGED`, moves the
 * task `APPROVED → COMPLETED`, and publishes `artifact.merged`.
 *
 * Idempotency is enforced by keying on the `APPROVED` state: the subscriber
 * re-checks the task's current state and returns early unless it is still
 * `APPROVED`, so a re-delivered event is a no-op. A git failure — conflict or
 * otherwise — routes the task to `AWAITING_HUMAN_INTERVENTION` (`MERGE_FAILED`)
 * and never silently retries.
 */

import { and, asc, desc, eq, ne } from 'drizzle-orm';

import { agentRuns, artifacts, changes, decisions, snapshots } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { ArtifactStatus, brand, EventType, TaskStatus } from '@harness/domain';
import type { ArtifactMergedPayload, TaskID, TaskStateChangedPayload } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { TaskService } from '@harness/orchestrator';
import type { Logger } from '@harness/di';
import type { ContentStore } from '@harness/object-store';
import { streamToString } from '@harness/object-store';

import type { GitAdapter } from './git-adapter.js';

/** A single file to commit: provenance ids plus the resolved snapshot content. */
interface MergeFile {
  readonly changeId: string;
  readonly artifactId: string;
  readonly filePath: string;
  readonly content: string;
}

export class MergeService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly git: GitAdapter,
    private readonly taskService: TaskService,
    private readonly logger?: Logger,
    private readonly contentStore?: ContentStore,
  ) {}

  /** Attach the APPROVED handler; returns nothing (fire-and-forget). */
  subscribe(): void {
    this.bus.subscribe<TaskStateChangedPayload>(EventType.TaskStateChanged, (event) => {
      if (event.payload.to_state !== TaskStatus.Approved) {
        return;
      }
      void this.onApproved(event.payload.task_id).catch((error) => {
        this.logger?.error('merge: approve follow-through failed', {
          correlation_id: event.correlation_id,
          task_id: event.payload.task_id,
          error: String(error),
        });
      });
    });
  }

  /** Merge the approved attempt's change set (idempotent on the APPROVED state). */
  async onApproved(taskId: TaskID): Promise<void> {
    const task = await this.taskService.getTask(taskId);
    if (!task || task.state !== TaskStatus.Approved) {
      return;
    }

    const files = await this.loadFiles(taskId, task.attemptNumber);
    if (files.length === 0) {
      // Nothing to commit: still close the loop so the task reaches a terminal state.
      await this.taskService.transitionTask(taskId, TaskStatus.Completed, 'orchestrator', {
        expectedFrom: TaskStatus.Approved,
      });
      return;
    }

    const reviewerId = await this.latestReviewerId(taskId);
    const message = `harness: task ${taskId} (attempt ${task.attemptNumber})\n\nReviewed-by: ${
      reviewerId ?? 'unknown'
    }`;

    let commitSha: string;
    try {
      commitSha = await this.git.applyAndCommit(
        files.map((file) => ({ filePath: file.filePath, content: file.content })),
        { message },
      );
    } catch (error) {
      await this.transitionMergeFailed(taskId, error);
      return;
    }

    // Record the merge outcome (guarded/idempotent writes).
    for (const file of files) {
      await this.db
        .update(changes)
        .set({ commit_sha: commitSha })
        .where(eq(changes.id, file.changeId));
      await this.db
        .update(artifacts)
        .set({ status: ArtifactStatus.Merged, updated_at: new Date() })
        .where(and(eq(artifacts.id, file.artifactId), ne(artifacts.status, ArtifactStatus.Merged)));
    }

    await this.taskService.transitionTask(taskId, TaskStatus.Completed, 'orchestrator', {
      expectedFrom: TaskStatus.Approved,
      rationale: `merged as ${commitSha}`,
    });

    const payload: ArtifactMergedPayload = { task_id: taskId, commit_sha: commitSha };
    this.bus.publish(
      createEvent(EventType.ArtifactMerged, brand(taskId, 'CorrelationID'), payload),
    );
  }

  /** Merge failure escape hatch: never retry, hand the task to a human. */
  private async transitionMergeFailed(taskId: TaskID, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    await this.taskService.transitionTask(
      taskId,
      TaskStatus.AwaitingHumanIntervention,
      'orchestrator',
      { expectedFrom: TaskStatus.Approved, rationale: `MERGE_FAILED: ${reason}` },
    );
  }

  /** The attempt's change set: latest snapshot content per file path. */
  private async loadFiles(taskId: TaskID, attemptNumber: number): Promise<MergeFile[]> {
    const rows = await this.db
      .select({
        changeId: changes.id,
        artifactId: changes.artifact_id,
        filePath: artifacts.file_path,
        contentHash: changes.content_hash,
      })
      .from(changes)
      .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
      .innerJoin(artifacts, eq(artifacts.id, changes.artifact_id))
      .where(and(eq(agentRuns.task_id, taskId), eq(agentRuns.attempt_number, attemptNumber)))
      .orderBy(asc(changes.created_at));

    // A file may be written more than once in an attempt; the latest write wins.
    const byPath = new Map<string, MergeFile>();
    for (const row of rows) {
      byPath.set(row.filePath, {
        changeId: row.changeId,
        artifactId: row.artifactId,
        filePath: row.filePath,
        content: await this.contentFor(row.contentHash),
      });
    }
    return [...byPath.values()];
  }

  /** Content-addressed snapshot lookup (day-14 §2.3, day-21 §3.4). */
  private async contentFor(hash: string): Promise<string> {
    const rows = await this.db
      .select({
        content: snapshots.content,
        content_hash: snapshots.content_hash,
        content_backend: snapshots.content_backend,
      })
      .from(snapshots)
      .where(eq(snapshots.content_hash, hash))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return '';
    }
    if (row.content_backend === 'object' && this.contentStore !== undefined) {
      return streamToString(
        await this.contentStore.get({ hash: row.content_hash, backend: 'object' }),
      );
    }
    return row.content ?? '';
  }

  /** The reviewer who approved (for the commit message). */
  private async latestReviewerId(taskId: TaskID): Promise<string | null> {
    const rows = await this.db
      .select({ reviewerId: decisions.reviewer_id })
      .from(decisions)
      .innerJoin(changes, eq(changes.id, decisions.change_id))
      .innerJoin(agentRuns, eq(agentRuns.id, changes.agent_run_id))
      .where(eq(agentRuns.task_id, taskId))
      .orderBy(desc(decisions.created_at))
      .limit(1);
    return rows[0]?.reviewerId ?? null;
  }
}
