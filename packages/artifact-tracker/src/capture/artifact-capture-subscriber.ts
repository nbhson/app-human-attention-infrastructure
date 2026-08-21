/**
 * `ArtifactCaptureSubscriber` (day-13 §3.6, day-14 §2.4) — bridges the
 * `artifact.created` event to {@link ArtifactTracker.capture}.
 *
 * `write_file` (in `@harness/agent-runtime`) publishes `artifact.created` on
 * success. This subscriber forwards each event to the tracker, which resolves
 * the run's project through `agent_runs → tasks → project` and performs the
 * transactional get-or-create-artifact → change → snapshot writes. Since Day 14
 * it carries no persistence logic of its own.
 *
 * The handler is synchronous on the bus and fires an unawaited capture (the bus
 * dispatches synchronously; the DB write is deliberately fire-and-forget).
 */

import { EventType } from '@harness/domain';
import type { ArtifactCreatedPayload } from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';

import type { ArtifactTracker } from '../artifact-tracker.js';

export class ArtifactCaptureSubscriber {
  constructor(
    private readonly tracker: ArtifactTracker,
    private readonly logger?: Logger,
  ) {}

  /** Subscribe to `artifact.created`; the returned handler is fire-and-forget. */
  subscribe(bus: IEventBus): void {
    bus.subscribe<ArtifactCreatedPayload>(EventType.ArtifactCreated, (event) => {
      void this.capture(event.payload).catch((error) => {
        this.logger?.error('artifact capture: record artifact failed', {
          correlation_id: event.correlation_id,
          agent_run_id: event.payload.agent_run_id,
          file_path: event.payload.file_path,
          error: String(error),
        });
      });
    });
  }

  /** Forward one `artifact.created` payload into the tracker. */
  async capture(payload: ArtifactCreatedPayload): Promise<void> {
    await this.tracker.capture({
      agentRunId: payload.agent_run_id,
      filePath: payload.file_path,
      content: payload.content,
    });
  }
}
