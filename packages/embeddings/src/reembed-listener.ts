/**
 * ReembedListener (day-17 §2.3) — re-embed a source when its artifact changes.
 *
 * Subscribes to `artifact.created` / `artifact.changed` and re-computes the
 * affected FILE source's vector, keyed on `content_hash`. An unchanged hash is a
 * no-op (the indexer is idempotent); a changed hash leaves the old row stale
 * until the new vector is written. The listener is a *side effect on the index*:
 * it publishes nothing (day-17 §6) and never throws onto the synchronous bus —
 * a failure is logged and the row is simply left pending/stale for a later run.
 */

import { EventType } from '@harness/domain';
import type { ArtifactChangedPayload, ArtifactCreatedPayload } from '@harness/domain';
import type { DrizzleDB } from '@harness/db';
import type { IEventBus } from '@harness/event-bus';

import type { EmbeddingIndexer } from './indexer.js';
import type { IndexLogger } from './logger.js';
import { resolveChangedSource, sourceFromCreated } from './sources.js';

export class ReembedListener {
  constructor(
    private readonly db: DrizzleDB,
    private readonly indexer: EmbeddingIndexer,
    private readonly logger?: IndexLogger,
  ) {}

  subscribe(bus: IEventBus): void {
    bus.subscribe<ArtifactCreatedPayload>(EventType.ArtifactCreated, (event) => {
      void this.onCreated(event.payload).catch((error) =>
        this.fail('artifact.created', error, event.correlation_id),
      );
    });
    bus.subscribe<ArtifactChangedPayload>(EventType.ArtifactChanged, (event) => {
      void this.onChanged(event.payload).catch((error) =>
        this.fail('artifact.changed', error, event.correlation_id),
      );
    });
  }

  /** One `artifact.created`: embed the inline content as a FILE source. */
  async onCreated(payload: ArtifactCreatedPayload): Promise<void> {
    await this.indexer.run([sourceFromCreated(payload)], 1);
  }

  /** One `artifact.changed`: resolve the source and re-embed (no-op if unknown). */
  async onChanged(payload: ArtifactChangedPayload): Promise<void> {
    const source = await resolveChangedSource(this.db, payload);
    if (source === null) {
      return; // gone/unknown — leave any existing row stale (read-path guard)
    }
    await this.indexer.run([source], 1);
  }

  private fail(eventType: string, error: unknown, correlationId?: string): void {
    this.logger?.error(`semantic index: re-embed on ${eventType} failed`, {
      error: String(error),
      correlation_id: correlationId,
    });
  }
}
