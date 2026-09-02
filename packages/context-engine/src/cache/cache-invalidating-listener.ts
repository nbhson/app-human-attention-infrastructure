/**
 * CacheInvalidationListener (day-20 §2.2) — tear a cached source down when its
 * artifact changes, so the next collect re-reads the fresh content rather than
 * serving a stale row off the stat fast-path.
 *
 * `gotByStat` deliberately matches only `(source_id, mtime, size)`. A re-write
 * that preserves both (rare on a real filesystem, but permitted by the contract)
 * is not distinguishable from the cache's perspective, so correctness leans on
 * the listener: on `artifact.changed` we drop the row with extreme prejudice.
 * The content-addressed `get(sourceId, contentHash)` path stays authoritatively
 * correct regardless, because the collector hashes what it reads.
 *
 * The listener is a *side effect on the cache*: it publishes nothing and never
 * throws onto the synchronous bus — a failure is logged and the stale row is
 * simply left for the next collect's miss path to overwrite (day-20 §6).
 */

import { eq } from 'drizzle-orm';

import { artifacts } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { Logger } from '@harness/di';
import { EventType } from '@harness/domain';
import type { ArtifactChangedPayload, ArtifactCreatedPayload } from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';

import type { ContextCache } from './context-cache.js';

export class CacheInvalidationListener {
  constructor(
    private readonly db: DrizzleDB,
    private readonly cache: ContextCache,
    private readonly logger?: Logger,
  ) {}

  subscribe(bus: IEventBus): void {
    bus.subscribe<ArtifactCreatedPayload>(EventType.ArtifactCreated, (event) => {
      void this.onCreated(event.payload).catch((error) => this.fail('artifact.created', error, event.correlation_id));
    });
    bus.subscribe<ArtifactChangedPayload>(EventType.ArtifactChanged, (event) => {
      void this.onChanged(event.payload).catch((error) => this.fail('artifact.changed', error, event.correlation_id));
    });
  }

  /** A freshly written file invalidates by its inline `file_path`. */
  async onCreated(payload: ArtifactCreatedPayload): Promise<void> {
    await this.cache.invalidate(payload.file_path);
  }

  /** A change carries only the new hash — resolve `artifact_id` → `file_path`. */
  async onChanged(payload: ArtifactChangedPayload): Promise<void> {
    const [artifactRow] = await this.db
      .select({ filePath: artifacts.file_path })
      .from(artifacts)
      .where(eq(artifacts.id, payload.artifact_id))
      .limit(1);
    const filePath = artifactRow?.filePath;
    if (filePath === undefined) {
      return; // gone/unknown — nothing cached under a path we can't name.
    }
    await this.cache.invalidate(filePath);
  }

  private fail(eventType: string, error: unknown, correlationId?: string): void {
    this.logger?.error(`context cache: invalidate on ${eventType} failed`, {
      error: String(error),
      correlation_id: correlationId,
    });
  }
}
