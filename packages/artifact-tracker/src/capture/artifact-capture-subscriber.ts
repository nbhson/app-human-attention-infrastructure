/**
 * `ArtifactCaptureSubscriber` (day-13 §3.6) — the lightweight Artifact Tracker
 * stub.
 *
 * `write_file` (in `@harness/agent-runtime`) publishes `artifact.created` on
 * success; this subscriber turns each event into a minimal `artifacts` row so
 * every file the agent writes is registered in the system of record. The full
 * Tracker engine — content-addressed snapshots and change lifecycle — lands on
 * Day 14 and *replaces* this inline insert.
 *
 * The `artifacts` table requires a `project_id`, which the event does not carry,
 * so we resolve it through the provenance chain `agent_runs → tasks → project`.
 * A fresh artifact starts in `DRAFT` (the default from `createArtifact`); the
 * event's `content_hash`/`size_bytes` are not yet persisted here — they become
 * the `snapshots` row on Day 14.
 *
 * The handler is synchronous on the bus and fires an unawaited insert (the bus
 * dispatches synchronously; the DB write is deliberately fire-and-forget).
 */

import { eq } from 'drizzle-orm';

import { ArtifactStatus, EventType, newArtifactID } from '@harness/domain';
import type { ArtifactCreatedPayload } from '@harness/domain';
import { agentRuns, artifacts, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { IEventBus } from '@harness/event-bus';

export class ArtifactCaptureSubscriber {
  constructor(private readonly db: DrizzleDB) {}

  /** Subscribe to `artifact.created`; the returned handler is fire-and-forget. */
  subscribe(bus: IEventBus): void {
    bus.subscribe<ArtifactCreatedPayload>(EventType.ArtifactCreated, (event) => {
      void this.capture(event.payload).catch((error) => {
        console.error('[artifact-capture] failed to record artifact:', error);
      });
    });
  }

  /** Resolve the run's project and insert a minimal `artifacts` row. */
  async capture(payload: ArtifactCreatedPayload): Promise<void> {
    const rows = await this.db
      .select({ project_id: tasks.project_id })
      .from(agentRuns)
      .innerJoin(tasks, eq(agentRuns.task_id, tasks.id))
      .where(eq(agentRuns.id, payload.agent_run_id))
      .limit(1);
    const projectId = rows[0]?.project_id;
    if (!projectId) {
      // Unknown agent run — drop silently (stub; the full tracker handles this).
      return;
    }
    await this.db
      .insert(artifacts)
      .values({
        id: newArtifactID(),
        project_id: projectId,
        file_path: payload.file_path,
        status: ArtifactStatus.Draft,
      })
      .onConflictDoNothing();
  }
}
