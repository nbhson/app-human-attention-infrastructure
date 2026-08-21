import { EventType, type EventEnvelope } from '@harness/domain';
import type { IEventBus } from '@harness/event-bus';

import type { DrizzleDB } from './client.js';
import { eventLog } from './schema/index.js';

/**
 * Minimal structural logger shape (day-27 §2.1). `db` may not import
 * `@harness/di` (boundary R4), so it accepts just the `error` level it needs and
 * the composition root hands it the real logger.
 */
export interface EventLogWriterLogger {
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Persists every bus event to the append-only `event_log` table.
 *
 * The write is fire-and-forget by design (day-04 §6): making `publish` block on
 * a DB write would couple every emitter to storage latency. Phase 1 accepts the
 * small risk of a lost log line; Phase 2 adds a write queue.
 */
export class EventLogWriter {
  constructor(
    private readonly db: DrizzleDB,
    private readonly logger?: EventLogWriterLogger,
  ) {}

  /** Insert one event; a duplicate `event_id` is a silent no-op (idempotent). */
  async write<T>(event: EventEnvelope<T>): Promise<void> {
    await this.db
      .insert(eventLog)
      .values({
        event_id: event.event_id,
        event_type: event.event_type,
        event_version: event.event_version,
        occurred_at: event.occurred_at,
        correlation_id: event.correlation_id,
        payload: event.payload,
      })
      .onConflictDoNothing();
  }

  /** Subscribe to every known event type and forward each one to {@link write}. */
  subscribeTo(bus: IEventBus): void {
    for (const eventType of Object.values(EventType)) {
      bus.subscribe(eventType, (event: EventEnvelope) => {
        void this.write(event).catch((error: unknown) => {
          this.logger?.error('EventLogWriter write failed', {
            event_type: event.event_type,
            correlation_id: event.correlation_id,
            error: String(error),
          });
        });
      });
    }
  }
}
